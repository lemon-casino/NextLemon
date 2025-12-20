use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::time::Duration;

// ==================== 数据结构 ====================

/// 处理 PPT 页面的请求参数
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPageParams {
    /// base64 编码的 PNG 图片
    pub image_data: String,
    /// PaddleOCR 服务地址 (如 http://127.0.0.1:8866)
    pub ocr_api_url: String,
    /// IOPaint 服务地址 (如 http://127.0.0.1:8080)
    pub inpaint_api_url: String,
    /// 蒙版扩展边距（像素）
    #[serde(default = "default_mask_padding")]
    pub mask_padding: u32,
}

fn default_mask_padding() -> u32 {
    5
}

/// 文本框数据
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextBoxData {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub text: String,
    pub font_size: f64,
}

/// 处理结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPageResult {
    pub success: bool,
    /// 去除文字后的背景图 (base64 PNG)
    pub background_image: Option<String>,
    /// 检测到的文本框列表
    pub text_boxes: Vec<TextBoxData>,
    /// 错误信息
    pub error: Option<String>,
}

// ==================== OCR 服务相关结构 ====================

/// PaddleOCR 请求
#[derive(Debug, Serialize)]
struct OcrRequest {
    images: Vec<String>,
}

/// PaddleOCR 响应
#[derive(Debug, Deserialize)]
struct OcrResponse {
    results: Option<Vec<OcrPageResult>>,
    msg: Option<String>,
    status: Option<String>,
}

/// 单页 OCR 结果
#[derive(Debug, Deserialize)]
struct OcrPageResult {
    /// 文字区域多边形坐标
    #[serde(default)]
    dt_polys: Vec<Vec<Vec<f64>>>,
    /// 识别的文字
    #[serde(default)]
    rec_texts: Vec<String>,
    /// 识别置信度
    #[serde(default)]
    #[allow(dead_code)]
    rec_scores: Vec<f64>,
}

// ==================== IOPaint 服务相关结构 ====================

/// IOPaint 请求
#[derive(Debug, Serialize)]
struct InpaintRequest {
    image: String,
    mask: String,
    ldm_steps: u32,
    hd_strategy: String,
}

// ==================== 测试连接相关结构 ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionParams {
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub success: bool,
    pub message: String,
}

// ==================== Tauri 命令 ====================

/// 处理单个 PPT 页面：OCR 识别 + 背景修复
#[tauri::command]
pub async fn process_ppt_page(params: ProcessPageParams) -> ProcessPageResult {
    println!("[Rust] process_ppt_page called");
    println!("[Rust] OCR API: {}", params.ocr_api_url);
    println!("[Rust] Inpaint API: {}", params.inpaint_api_url);

    // 创建 HTTP 客户端
    let client = match Client::builder()
        .timeout(Duration::from_secs(300)) // 5 分钟超时
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ProcessPageResult {
                success: false,
                background_image: None,
                text_boxes: vec![],
                error: Some(format!("创建 HTTP 客户端失败: {}", e)),
            }
        }
    };

    // 1. 调用 OCR 服务
    println!("[Rust] Step 1: Calling OCR service...");
    let ocr_result = match call_ocr_service(&client, &params.ocr_api_url, &params.image_data).await
    {
        Ok(r) => r,
        Err(e) => {
            return ProcessPageResult {
                success: false,
                background_image: None,
                text_boxes: vec![],
                error: Some(format!("OCR 服务调用失败: {}", e)),
            }
        }
    };

    println!(
        "[Rust] OCR detected {} text regions",
        ocr_result.text_boxes.len()
    );

    // 如果没有检测到文字，直接返回原图
    if ocr_result.text_boxes.is_empty() {
        return ProcessPageResult {
            success: true,
            background_image: Some(params.image_data),
            text_boxes: vec![],
            error: None,
        };
    }

    // 2. 创建蒙版并调用 Inpaint 服务
    println!("[Rust] Step 2: Creating mask and calling inpaint service...");
    let background_image = match call_inpaint_service(
        &client,
        &params.inpaint_api_url,
        &params.image_data,
        &ocr_result.text_boxes,
        ocr_result.image_width,
        ocr_result.image_height,
        params.mask_padding,
    )
    .await
    {
        Ok(img) => img,
        Err(e) => {
            return ProcessPageResult {
                success: false,
                background_image: None,
                text_boxes: ocr_result.text_boxes,
                error: Some(format!("背景修复失败: {}", e)),
            }
        }
    };

    println!("[Rust] process_ppt_page completed successfully");

    ProcessPageResult {
        success: true,
        background_image: Some(background_image),
        text_boxes: ocr_result.text_boxes,
        error: None,
    }
}

/// 测试 OCR 服务连接
#[tauri::command]
pub async fn test_ocr_connection(params: TestConnectionParams) -> TestConnectionResult {
    println!("[Rust] Testing OCR connection: {}", params.url);

    let client = match Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TestConnectionResult {
                success: false,
                message: format!("创建客户端失败: {}", e),
            }
        }
    };

    // 尝试访问 OCR 服务健康检查端点
    let health_url = format!("{}/", params.url.trim_end_matches('/'));

    match client.get(&health_url).send().await {
        Ok(resp) => {
            if resp.status().is_success() || resp.status().as_u16() == 405 {
                // 405 表示端点存在但方法不对，服务可用
                TestConnectionResult {
                    success: true,
                    message: "OCR 服务连接成功".to_string(),
                }
            } else {
                TestConnectionResult {
                    success: false,
                    message: format!("服务返回状态码: {}", resp.status()),
                }
            }
        }
        Err(e) => {
            if e.is_connect() {
                TestConnectionResult {
                    success: false,
                    message: "无法连接到服务，请检查服务是否启动".to_string(),
                }
            } else if e.is_timeout() {
                TestConnectionResult {
                    success: false,
                    message: "连接超时".to_string(),
                }
            } else {
                TestConnectionResult {
                    success: false,
                    message: format!("连接错误: {}", e),
                }
            }
        }
    }
}

/// 测试 IOPaint 服务连接
#[tauri::command]
pub async fn test_inpaint_connection(params: TestConnectionParams) -> TestConnectionResult {
    println!("[Rust] Testing IOPaint connection: {}", params.url);

    let client = match Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return TestConnectionResult {
                success: false,
                message: format!("创建客户端失败: {}", e),
            }
        }
    };

    // IOPaint 健康检查
    let health_url = format!("{}/", params.url.trim_end_matches('/'));

    match client.get(&health_url).send().await {
        Ok(resp) => {
            if resp.status().is_success()
                || resp.status().as_u16() == 404
                || resp.status().as_u16() == 405
            {
                // IOPaint 的根路径可能返回 404，但服务仍然可用
                TestConnectionResult {
                    success: true,
                    message: "IOPaint 服务连接成功".to_string(),
                }
            } else {
                TestConnectionResult {
                    success: false,
                    message: format!("服务返回状态码: {}", resp.status()),
                }
            }
        }
        Err(e) => {
            if e.is_connect() {
                TestConnectionResult {
                    success: false,
                    message: "无法连接到服务，请检查服务是否启动".to_string(),
                }
            } else if e.is_timeout() {
                TestConnectionResult {
                    success: false,
                    message: "连接超时".to_string(),
                }
            } else {
                TestConnectionResult {
                    success: false,
                    message: format!("连接错误: {}", e),
                }
            }
        }
    }
}

// ==================== 内部函数 ====================

/// OCR 服务调用结果
struct OcrServiceResult {
    text_boxes: Vec<TextBoxData>,
    image_width: u32,
    image_height: u32,
}

/// 调用 PaddleOCR 服务
async fn call_ocr_service(
    client: &Client,
    api_url: &str,
    image_data: &str,
) -> Result<OcrServiceResult, String> {
    // 解码图片获取尺寸
    let image_bytes = STANDARD
        .decode(image_data)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    let img = image::load_from_memory(&image_bytes).map_err(|e| format!("图片解析失败: {}", e))?;

    let image_width = img.width();
    let image_height = img.height();
    println!(
        "[Rust] Image size: {}x{}",
        image_width, image_height
    );

    // 构建 OCR 请求
    let ocr_url = format!("{}/predict/ocr", api_url.trim_end_matches('/'));
    let request_body = OcrRequest {
        images: vec![image_data.to_string()],
    };

    println!("[Rust] Sending OCR request to: {}", ocr_url);

    let response = client
        .post(&ocr_url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "无法连接到 OCR 服务，请检查服务是否启动".to_string()
            } else if e.is_timeout() {
                "OCR 请求超时".to_string()
            } else {
                format!("OCR 请求失败: {}", e)
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OCR 服务返回错误 ({}): {}", status, error_text));
    }

    let ocr_response: OcrResponse = response
        .json()
        .await
        .map_err(|e| format!("解析 OCR 响应失败: {}", e))?;

    // 检查服务状态
    if let Some(status) = &ocr_response.status {
        if status != "000" && status.to_lowercase() != "success" {
            return Err(format!(
                "OCR 服务错误: {}",
                ocr_response.msg.unwrap_or_default()
            ));
        }
    }

    // 提取文本框
    let mut text_boxes = Vec::new();

    if let Some(results) = ocr_response.results {
        if let Some(page_result) = results.first() {
            for (i, poly) in page_result.dt_polys.iter().enumerate() {
                if poly.len() < 4 {
                    continue;
                }

                // 计算边界框
                let x_coords: Vec<f64> = poly.iter().map(|p| p.get(0).copied().unwrap_or(0.0)).collect();
                let y_coords: Vec<f64> = poly.iter().map(|p| p.get(1).copied().unwrap_or(0.0)).collect();

                let x_min = x_coords.iter().cloned().fold(f64::INFINITY, f64::min);
                let x_max = x_coords.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                let y_min = y_coords.iter().cloned().fold(f64::INFINITY, f64::min);
                let y_max = y_coords.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

                let width = x_max - x_min;
                let height = y_max - y_min;

                // 过滤太小的区域
                if width < 10.0 || height < 10.0 {
                    continue;
                }

                // 获取识别的文字
                let text = page_result
                    .rec_texts
                    .get(i)
                    .cloned()
                    .unwrap_or_default();

                // 估算字号（基于高度）
                let font_size = (height * 0.7 * 72.0 / 96.0).max(8.0).min(72.0);

                text_boxes.push(TextBoxData {
                    x: x_min.max(0.0),
                    y: y_min.max(0.0),
                    width,
                    height,
                    text,
                    font_size,
                });
            }
        }
    }

    // 按阅读顺序排序（从上到下，从左到右）
    text_boxes.sort_by(|a, b| {
        let row_a = (a.y / 30.0) as i32;
        let row_b = (b.y / 30.0) as i32;
        if row_a != row_b {
            row_a.cmp(&row_b)
        } else {
            a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal)
        }
    });

    Ok(OcrServiceResult {
        text_boxes,
        image_width,
        image_height,
    })
}

/// 调用 IOPaint 服务进行背景修复
async fn call_inpaint_service(
    client: &Client,
    api_url: &str,
    image_data: &str,
    text_boxes: &[TextBoxData],
    image_width: u32,
    image_height: u32,
    mask_padding: u32,
) -> Result<String, String> {
    // 创建蒙版图片
    let mask_base64 = create_mask_image(text_boxes, image_width, image_height, mask_padding)?;

    // 构建 IOPaint 请求
    let inpaint_url = format!("{}/api/v1/inpaint", api_url.trim_end_matches('/'));
    let request_body = InpaintRequest {
        image: image_data.to_string(),
        mask: mask_base64,
        ldm_steps: 30,
        hd_strategy: "Original".to_string(),
    };

    println!("[Rust] Sending inpaint request to: {}", inpaint_url);

    let response = client
        .post(&inpaint_url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "无法连接到 IOPaint 服务，请检查服务是否启动".to_string()
            } else if e.is_timeout() {
                "背景修复请求超时（可能需要更长时间）".to_string()
            } else {
                format!("背景修复请求失败: {}", e)
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "IOPaint 服务返回错误 ({}): {}",
            status,
            &error_text[..error_text.len().min(200)]
        ));
    }

    // IOPaint 直接返回图片二进制数据
    let image_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("获取修复图片失败: {}", e))?;

    // 转换为 base64
    let result_base64 = STANDARD.encode(&image_bytes);

    Ok(result_base64)
}

/// 根据文本框位置创建蒙版图片
fn create_mask_image(
    text_boxes: &[TextBoxData],
    width: u32,
    height: u32,
    padding: u32,
) -> Result<String, String> {
    use image::{ImageBuffer, Luma};

    // 创建全黑图片（黑色 = 保留区域）
    let mut mask: ImageBuffer<Luma<u8>, Vec<u8>> = ImageBuffer::new(width, height);

    // 将文本框区域标记为白色（白色 = 需要修复的区域）
    for box_data in text_boxes {
        let x1 = (box_data.x as i32 - padding as i32).max(0) as u32;
        let y1 = (box_data.y as i32 - padding as i32).max(0) as u32;
        let x2 = ((box_data.x + box_data.width) as u32 + padding).min(width);
        let y2 = ((box_data.y + box_data.height) as u32 + padding).min(height);

        for y in y1..y2 {
            for x in x1..x2 {
                mask.put_pixel(x, y, Luma([255u8]));
            }
        }
    }

    // 转换为 PNG 并编码为 base64
    let mut buffer = Cursor::new(Vec::new());
    mask.write_to(&mut buffer, image::ImageFormat::Png)
        .map_err(|e| format!("创建蒙版图片失败: {}", e))?;

    let mask_base64 = STANDARD.encode(buffer.into_inner());

    Ok(mask_base64)
}

use tauri::{AppHandle, Emitter, Manager};
use futures_util::StreamExt;
use reqwest::Client;
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};

// Lemon API 流式请求参数
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LemonStreamParams {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    pub input_images: Option<Vec<String>>,
    pub channel_id: String, // 用于区分不同的 SSE 频道
}

// 简单的 OpenAI 格式请求体（Lemon API 兼容）
#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f64,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct OpenAIMessage {
    role: String,
    content: OpenAIMessageContent,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum OpenAIMessageContent {
    Text(String),
    MultiPart(Vec<OpenAIContentPart>),
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
enum OpenAIContentPart {
    Text { text: String },
    ImageUrl { image_url: OpenAIImageUrl },
}

#[derive(Debug, Serialize)]
struct OpenAIImageUrl {
    url: String,
}

// Rust Command: Lemon API 流式生成
#[tauri::command]
pub async fn lemon_stream_generation(app_handle: AppHandle, params: LemonStreamParams) -> Result<(), String> {
    println!("[Rust] lemon_stream_generation called, channel_id: {}", params.channel_id);

    // 构建消息内容
    let content = if let Some(images) = &params.input_images {
        let mut parts = vec![OpenAIContentPart::Text { text: params.prompt.clone() }];
        for img in images {
            let url = if img.starts_with("data:") {
                img.clone()
            } else {
                format!("data:image/png;base64,{}", img)
            };
            parts.push(OpenAIContentPart::ImageUrl {
                image_url: OpenAIImageUrl { url }
            });
        }
        OpenAIMessageContent::MultiPart(parts)
    } else {
        OpenAIMessageContent::Text(params.prompt.clone())
    };

    let request_body = OpenAIRequest {
        model: params.model.clone(),
        messages: vec![OpenAIMessage {
            role: "user".to_string(),
            content,
        }],
        temperature: 0.7,
        stream: true,
    };

    let url = format!("{}/v1/chat/completions", params.base_url.trim_end_matches('/'));
    
    // 创建客户端
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    // 发起请求
    let response = client.post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", params.api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("API Error ({}): {}", response.status(), err_text));
    }

    // 处理流
    let mut stream = response.bytes_stream();
    let channel_id = params.channel_id.clone();
    
    tokio::spawn(async move {
        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    if let Ok(text) = String::from_utf8(chunk.to_vec()) {
                         // 直接将原始 chunk 文本发送给前端，由前端解析 SSE
                        let _ = app_handle.emit(&format!("stream://{}", channel_id), text);
                    }
                },
                Err(e) => {
                    println!("[Rust] Stream error: {}", e);
                    let _ = app_handle.emit(&format!("stream-error://{}", channel_id), e.to_string());
                    break;
                }
            }
        }
        // 发送完成信号
        let _ = app_handle.emit(&format!("stream-done://{}", channel_id), ());
    });

    Ok(())
}

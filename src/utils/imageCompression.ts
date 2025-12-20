/**
 * 图片压缩工具
 * 用于生成缩略图，优化画布预览性能
 */

export interface ThumbnailOptions {
  maxWidth?: number; // 最大宽度，默认 800px
  quality?: number; // JPEG 质量，0-1，默认 0.85
  format?: "jpeg" | "webp"; // 输出格式，默认 jpeg
}

/**
 * 从 base64 图片生成缩略图
 * @param base64Data - 原图 base64（不含 data:image/xxx;base64, 前缀）
 * @param options - 压缩选项
 * @returns 缩略图的 base64（不含前缀）
 */
export function generateThumbnail(
  base64Data: string,
  options: ThumbnailOptions = {}
): Promise<string> {
  const { maxWidth = 800, quality = 0.85, format = "jpeg" } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        // 计算缩放后的尺寸
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        // 创建 canvas 并绘制
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("无法创建 canvas context"));
          return;
        }

        // 使用高质量缩放
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        // 转换为目标格式
        const mimeType = format === "webp" ? "image/webp" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mimeType, quality);

        // 移除 data:image/xxx;base64, 前缀
        const base64 = dataUrl.split(",")[1];
        resolve(base64);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error("图片加载失败"));
    };

    // 加载原图
    img.src = `data:image/png;base64,${base64Data}`;
  });
}

/**
 * 批量生成缩略图
 * @param images - base64 图片数组
 * @param options - 压缩选项
 * @returns 缩略图 base64 数组
 */
export async function generateThumbnails(
  images: string[],
  options: ThumbnailOptions = {}
): Promise<string[]> {
  return Promise.all(images.map((img) => generateThumbnail(img, options)));
}

/**
 * 获取缩略图的 MIME 类型
 * @param format - 格式
 * @returns MIME 类型字符串
 */
export function getThumbnailMimeType(format: "jpeg" | "webp" = "jpeg"): string {
  return format === "webp" ? "image/webp" : "image/jpeg";
}

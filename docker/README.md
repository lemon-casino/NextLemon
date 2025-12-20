# NextLemon - OCR + Inpaint 服务部署

用于 PPT 可编辑导出功能的后端服务。

## 快速启动

```bash
cd docker
docker-compose up -d
```

## 服务说明

| 服务 | 端口 | 用途 |
|------|------|------|
| EasyOCR | 8866 | 文字检测和识别 |
| IOPaint | 8080 | AI 背景修复（去除文字） |

## 首次启动

首次启动需要下载模型文件，可能需要 3-5 分钟。

查看启动日志：
```bash
docker-compose logs -f
```

## 测试服务

### 测试 EasyOCR
```bash
curl http://127.0.0.1:8866/
# 返回: {"languages":["ch_sim","en"],"service":"EasyOCR","status":"ok"}
```

### 测试 IOPaint
```bash
curl http://127.0.0.1:8080/
# 返回 IOPaint 配置信息
```

## 在 NextLemon 中配置

1. 打开 PPT 组装节点
2. 点击右上角设置按钮
3. 填入服务地址：
   - OCR 服务: `http://127.0.0.1:8866`
   - IOPaint 服务: `http://127.0.0.1:8080`
4. 点击「测试」验证连接
5. 切换到「可编辑」导出模式

## 停止服务

```bash
docker-compose down
```

## 常见问题

### Q: 内存占用过高
A: 可以在 `docker-compose.yml` 中调整 `memory` 限制

### Q: 处理速度慢
A: 默认使用 CPU，如有 GPU 可修改相关配置

### Q: 模型下载失败
A: 检查网络连接，或配置代理

## 技术说明

- **EasyOCR**: 基于 PyTorch，支持 80+ 语言，对 ARM 架构兼容性好
- **IOPaint**: 使用 LaMa 模型进行图像修复，去除文字区域

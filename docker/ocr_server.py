"""
EasyOCR HTTP 服务
提供 OCR 文字检测和识别 API
兼容原 PaddleOCR API 格式
"""

from flask import Flask, request, jsonify
import easyocr
import base64
import tempfile
import os

app = Flask(__name__)

# 初始化 EasyOCR（首次运行会下载模型）
print("正在初始化 EasyOCR...")
reader = easyocr.Reader(
    ['ch_sim', 'en'],  # 支持简体中文和英文
    gpu=False,         # CPU 模式
)
print("EasyOCR 初始化完成")


@app.route('/predict/ocr', methods=['POST'])
def predict():
    """
    OCR 识别接口（兼容原 PaddleOCR API 格式）

    请求格式:
    {
        "images": ["base64_encoded_image", ...]
    }

    响应格式:
    {
        "status": "000",
        "results": [{
            "dt_polys": [[[x1,y1], [x2,y2], [x3,y3], [x4,y4]], ...],
            "rec_texts": ["识别的文字", ...],
            "rec_scores": [0.99, ...]
        }]
    }
    """
    try:
        data = request.json
        images = data.get('images', [])

        if not images:
            return jsonify({
                'status': 'error',
                'msg': 'No images provided'
            }), 400

        results = []

        for img_b64 in images:
            # 解码 base64 并保存为临时文件
            img_data = base64.b64decode(img_b64)

            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                f.write(img_data)
                temp_path = f.name

            try:
                # EasyOCR 识别
                # 返回格式: [([[x1,y1], [x2,y2], [x3,y3], [x4,y4]], "文字", 置信度), ...]
                ocr_result = reader.readtext(temp_path)
            finally:
                # 清理临时文件
                os.remove(temp_path)

            # 转换为兼容 PaddleOCR 的格式
            dt_polys = []
            rec_texts = []
            rec_scores = []

            for item in ocr_result:
                bbox, text, confidence = item
                # bbox 是四个点的坐标 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                # 需要将 numpy 类型转换为 Python 原生类型
                bbox_list = [[int(p[0]), int(p[1])] for p in bbox]
                dt_polys.append(bbox_list)
                rec_texts.append(str(text))
                rec_scores.append(float(confidence))

            results.append({
                'dt_polys': dt_polys,
                'rec_texts': rec_texts,
                'rec_scores': rec_scores
            })

        return jsonify({
            'status': '000',
            'results': results
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'msg': str(e)
        }), 500


@app.route('/', methods=['GET'])
def health():
    """健康检查接口"""
    return jsonify({
        'status': 'ok',
        'service': 'EasyOCR',
        'languages': ['ch_sim', 'en']
    })


if __name__ == '__main__':
    print('=' * 50)
    print('EasyOCR 服务启动中...')
    print('端口: 8866')
    print('API: POST /predict/ocr')
    print('支持语言: 简体中文, 英文')
    print('=' * 50)
    app.run(host='0.0.0.0', port=8866, threaded=True)

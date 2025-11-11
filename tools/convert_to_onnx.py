## /tools/convert_to_onnx.py

"""
ONNX Converter
Converte modello sklearn in formato ONNX per Node.js
"""

import joblib
import numpy as np
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import os

OUTPUT_DIR = os.getenv('OUTPUT_DIR', './models')

def convert_to_onnx():
    """Converte sklearn model in ONNX"""
    model_path = os.path.join(OUTPUT_DIR, 'pesca_model.pkl')
    onnx_path = os.path.join(OUTPUT_DIR, 'pesca_model.onnx')
    
    print(f"📦 Loading sklearn model from {model_path}")
    model = joblib.load(model_path)
    
    # Define input shape (13 features nel nostro caso)
    initial_type = [('input', FloatTensorType([None, 13]))]
    
    print("🔄 Converting to ONNX format...")
    onnx_model = convert_sklearn(
        model, 
        initial_types=initial_type,
        target_opset=12
    )
    
    # Save ONNX
    with open(onnx_path, 'wb') as f:
        f.write(onnx_model.SerializeToString())
    
    print(f"✅ ONNX model saved: {onnx_path}")
    
    # Verify
    import onnxruntime as rt
    sess = rt.InferenceSession(onnx_path)
    
    # Test inference
    test_input = np.random.randn(1, 13).astype(np.float32)
    output = sess.run(None, {'input': test_input})
    
    print(f"✅ ONNX model verified. Test output: {output[0][0]}")

if __name__ == '__main__':
    convert_to_onnx()
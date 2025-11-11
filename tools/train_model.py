## /tools/train_model.py

"""
ML Training Script (Zero-Cost)
Esegue training su GitHub Actions e salva modello ONNX
"""

import json
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, r2_score
import joblib
import os

# Config
DATA_FILE = os.getenv('DATA_FILE', 'training_data.json')
OUTPUT_DIR = os.getenv('OUTPUT_DIR', './models')
MIN_SAMPLES = 100  # Minimo episodi per training

def load_data():
    """Carica dati da JSON esportato dall'API"""
    with open(DATA_FILE, 'r') as f:
        data = json.load(f)
    
    episodes = data['episodes']
    print(f"📊 Loaded {len(episodes)} episodes")
    
    if len(episodes) < MIN_SAMPLES:
        raise ValueError(f"Not enough data: {len(episodes)} < {MIN_SAMPLES}")
    
    return episodes

def extract_features(episode):
    """Feature engineering (uguale a predict.service.js)"""
    weather = json.loads(episode['weather_json'])
    
    return {
        'temperature': weather.get('temp', 15),
        'wind_speed': weather.get('wind', 10),
        'pressure': weather.get('pressure', 1013),
        'clouds': weather.get('clouds', 50),
        'wave_height': weather.get('waveHeight', 1.0),
        'water_temp': weather.get('waterTemp', 16),
        'current_speed': weather.get('currentSpeed', 0.5),
        'moon_phase': weather.get('moonPhase', 0.5),
        'pressure_trend': weather.get('pressureTrend', 0),
        'latitude': episode['location_lat'],
        'longitude': episode['location_lon'],
        'hour': pd.to_datetime(episode['created_at'], unit='ms').hour,
        'day_of_week': pd.to_datetime(episode['created_at'], unit='ms').dayofweek,
        'month': pd.to_datetime(episode['created_at'], unit='ms').month
    }

def prepare_dataset(episodes):
    """Prepara X, y per training"""
    X_data = []
    y_data = []
    
    for ep in episodes:
        # Skip se mancano dati critici
        if ep['user_feedback'] is None or ep['pesca_score_final'] is None:
            continue
        
        features = extract_features(ep)
        X_data.append(list(features.values()))
        
        # Target: blend tra pesca_score e user_feedback
        target = (ep['pesca_score_final'] * 0.3) + (ep['user_feedback'] * 2 * 0.7)
        y_data.append(target)
    
    X = np.array(X_data)
    y = np.array(y_data)
    
    print(f"✅ Prepared {len(X)} training samples")
    return X, y, list(features.keys())

def train_model(X, y):
    """Training con Gradient Boosting"""
    # Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Normalize
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Train
    print("🤖 Training Gradient Boosting Regressor...")
    model = GradientBoostingRegressor(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        random_state=42
    )
    
    model.fit(X_train_scaled, y_train)
    
    # Evaluate
    y_pred = model.predict(X_test_scaled)
    mse = mean_squared_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    
    print(f"📊 Model Performance:")
    print(f"   MSE: {mse:.4f}")
    print(f"   R²: {r2:.4f}")
    
    return model, scaler

def save_model(model, scaler, feature_names):
    """Salva modello in formato sklearn (da convertire in ONNX dopo)"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Salva sklearn model
    model_path = os.path.join(OUTPUT_DIR, 'pesca_model.pkl')
    joblib.dump(model, model_path)
    print(f"✅ Model saved: {model_path}")
    
    # Salva scaler come JSON (per Node.js)
    scaler_dict = {
        'mean': scaler.mean_.tolist(),
        'std': scaler.scale_.tolist(),
        'feature_names': feature_names
    }
    
    scaler_path = os.path.join(OUTPUT_DIR, 'scaler.json')
    with open(scaler_path, 'w') as f:
        json.dump(scaler_dict, f, indent=2)
    print(f"✅ Scaler saved: {scaler_path}")

def main():
    print("🚀 Starting ML Training Pipeline...")
    
    # Load data
    episodes = load_data()
    
    # Prepare dataset
    X, y, feature_names = prepare_dataset(episodes)
    
    # Train
    model, scaler = train_model(X, y)
    
    # Save
    save_model(model, scaler, feature_names)
    
    print("🎉 Training completed!")

if __name__ == '__main__':
    main()
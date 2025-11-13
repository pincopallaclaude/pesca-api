// /lib/ml/predict.service.js

/**
 * ML Prediction Service (Zero-Cost)
 * - Training: Offline su GitHub Actions (2000 min/mese gratis)
 * - Inference: ONNX Runtime (5x più veloce di TF.js)
 * - Model: Hosted su GitHub Releases (gratis)
 */

import * as ort from 'onnxruntime-node';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import * as logger from '../utils/logger.js';;

let model = null;
let scaler = null;

const MODEL_DIR = process.env.NODE_ENV === 'production'
  ? '/data/ml'
  : './data/ml';

const MODEL_PATH = path.join(MODEL_DIR, 'pesca_model.onnx');
const SCALER_PATH = path.join(MODEL_DIR, 'scaler.json');

// GitHub Releases URLs (aggiorna con il tuo username)
const GITHUB_USER = process.env.GITHUB_USER || 'your-username';
const GITHUB_REPO = process.env.GITHUB_REPO || 'pesca-api';
const MODEL_URL = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/latest/download/pesca_model.onnx`;
const SCALER_URL = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/latest/download/scaler.json`;

/**
 * Scarica file da GitHub Releases
 */
async function downloadFile(url, destPath) {
  try {
    logger.log(`[ML] Downloading ${url}...`);
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, Buffer.from(response.data));
    logger.log(`[ML] ✅ Downloaded to ${destPath}`);
  } catch (error) {
    logger.error(`[ML] Download failed: ${error.message}`);
    throw error;
  }
}

/**
 * Carica modello all'avvio (one-time download)
 */
export async function loadModel() {
  try {
    // Check se model esiste localmente
    try {
      await fs.access(MODEL_PATH);
      await fs.access(SCALER_PATH);
      logger.log('[ML] Model files found locally');
    } catch {
      logger.warn('[ML] Model files not found, downloading...');
      await downloadFile(MODEL_URL, MODEL_PATH);
      await downloadFile(SCALER_URL, SCALER_PATH);
    }
    
    // Load ONNX model (fast!)
    model = await ort.InferenceSession.create(MODEL_PATH);
    logger.log('[ML] ✅ ONNX model loaded');
    
    // Load scaler
    const scalerData = await fs.readFile(SCALER_PATH, 'utf8');
    scaler = JSON.parse(scalerData);
    logger.log('[ML] ✅ Feature scaler loaded');
    
    return { success: true };
    
  } catch (error) {
    logger.error('[ML] Model loading failed:', error);
    // Non bloccare l'app, usa fallback
    return { success: false, error: error.message };
  }
}

/**
 * Feature engineering (identico a calcolo manuale)
 */
function extractFeatures(weatherData, astronomyData, location) {
  return {
    // Atmosferici
    temperature: weatherData.temp || 15,
    wind_speed: weatherData.wind || 10,
    pressure: weatherData.pressure || 1013,
    clouds: weatherData.clouds || 50,
    
    // Marini
    wave_height: weatherData.waveHeight || 1.0,
    water_temp: weatherData.waterTemp || 16,
    current_speed: weatherData.currentSpeed || 0.5,
    
    // Astronomici
    moon_phase: astronomyData.moonPhase || 0.5,
    
    // Trend
    pressure_trend: weatherData.pressureTrend || 0, // -1, 0, 1
    
    // Geografici
    latitude: location.lat,
    longitude: location.lon,
    
    // Temporali
    hour: new Date().getHours(),
    day_of_week: new Date().getDay(),
    month: new Date().getMonth() + 1
  };
}

/**
 * Normalizza features con scaler
 */
function normalizeFeatures(features) {
  if (!scaler) {
    logger.warn('[ML] Scaler not loaded, using raw features');
    return Object.values(features);
  }
  
  const normalized = [];
  const featureNames = Object.keys(features);
  
  for (let i = 0; i < featureNames.length; i++) {
    const name = featureNames[i];
    const value = features[name];
    const mean = scaler.mean[i] || 0;
    const std = scaler.std[i] || 1;
    
    normalized.push((value - mean) / std);
  }
  
  return normalized;
}

/**
 * Predizione ML (ONNX → 5x più veloce di TF.js)
 */
export async function predictPescaScore(weatherData, astronomyData, location) {
  try {
    // Fallback se model non caricato
    if (!model) {
      logger.warn('[ML] Model not loaded, using rule-based fallback');
      return { 
        predicted: null, 
        confidence: 0,
        method: 'rule-based' 
      };
    }
    
    // Extract & normalize features
    const features = extractFeatures(weatherData, astronomyData, location);
    const normalizedFeatures = normalizeFeatures(features);
    
    // Prepare input tensor
    const inputTensor = new ort.Tensor(
      'float32',
      Float32Array.from(normalizedFeatures),
      [1, normalizedFeatures.length]
    );
    
    // Run inference
    const startTime = Date.now();
    const results = await model.run({ input: inputTensor });
    const inferenceTime = Date.now() - startTime;
    
    // Extract prediction (assuming output name is 'output')
    const outputData = results.output.data;
    const predicted = outputData[0];
    const confidence = outputData[1] || 0.8; // Se modello non restituisce confidence
    
    logger.log(`[ML] Prediction: ${predicted.toFixed(2)} (${inferenceTime}ms)`); // MODIFICATO
    
    return {
      predicted: Math.max(0, Math.min(10, predicted)), // Clamp 0-10
      confidence: confidence,
      method: 'ml-onnx',
      inferenceTime: inferenceTime
    };
    
  } catch (error) {
    logger.error('[ML] Prediction failed:', error);
    return { 
      predicted: null, 
      confidence: 0,
      method: 'error',
      error: error.message
    };
  }
}

/**
 * Confronta predizione ML vs regole per debug
 */
export function comparePredictions(mlScore, ruleScore) {
  const diff = Math.abs(mlScore - ruleScore);
  const agreement = diff < 1.0 ? 'high' : diff < 2.0 ? 'medium' : 'low';
  
  return {
    ml_score: mlScore,
    rule_score: ruleScore,
    difference: diff,
    agreement: agreement
  };
}

/**
 * Health check
 */
export function getMLHealth() {
  return {
    model_loaded: model !== null,
    scaler_loaded: scaler !== null,
    model_path: MODEL_PATH,
    version: process.env.ML_MODEL_VERSION || '1.0'
  };
}

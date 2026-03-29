/**
 * Multimodal Ingestion — Unified Entry Point
 *
 * Re-exports all multimodal loaders for convenient access.
 */

export {
  transcribeAudio,
  ingestAudio,
  type AudioInput,
  type TranscriptionResult,
} from './audio-loader.js';

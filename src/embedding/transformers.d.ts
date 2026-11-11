/**
 * Type declarations for @huggingface/transformers (optional dependency).
 * Only the subset we use is declared here.
 */
declare module '@huggingface/transformers' {
    export interface PipelineOptions {
        dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
        device?: 'cpu' | 'webgpu';
        revision?: string;
    }

    export interface FeatureExtractionOptions {
        pooling?: 'mean' | 'cls';
        normalize?: boolean;
        quantize?: boolean;
        precision?: 'binary' | 'ubinary';
    }

    export interface Tensor {
        data: Float32Array;
        dims: number[];
        tolist(): number[][];
    }

    export type FeatureExtractionPipeline = (
        text: string | string[],
        options?: FeatureExtractionOptions,
    ) => Promise<Tensor>;

    export function pipeline(
        task: 'feature-extraction',
        model: string,
        options?: PipelineOptions,
    ): Promise<FeatureExtractionPipeline>;

    export function cos_sim(a: Float32Array, b: Float32Array): number;

    export const env: {
        allowRemoteModels: boolean;
        localModelPath: string;
    };
}

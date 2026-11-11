/**
 * Type declarations for fastembed (optional dependency).
 * Only the subset we use is declared here.
 */
declare module 'fastembed' {
  export enum EmbeddingModel {
    BGESmallENV15 = 'BGESmallENV15',
    BGEBaseENV15 = 'BGEBaseENV15',
    BGEBaseZHV15 = 'BGEBaseZHV15',
    AllMiniLML6V2 = 'AllMiniLML6V2',
    MultilingualE5Large = 'MultilingualE5Large',
  }

  export class FlagEmbedding {
    static init(options: { model: EmbeddingModel }): Promise<FlagEmbedding>;
    embed(documents: string[], batchSize?: number): AsyncGenerator<number[][]>;
    queryEmbed(query: string): Promise<number[]>;
    passageEmbed(documents: string[], batchSize?: number): AsyncGenerator<number[][]>;
  }
}

import type {
	AssistantImages,
	ImageContent,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
} from "../../types.ts";
import { isIP } from "node:net";
import { headersToRecord } from "../../utils/headers.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";

const MAX_GENERATED_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_COUNT = 4;

export interface MiniMaxImagesOptions extends ImagesOptions {
	aspectRatio?: "1:1" | "16:9" | "4:3" | "3:2" | "2:3" | "3:4" | "9:16" | "21:9";
	width?: number;
	height?: number;
	responseFormat?: "url" | "base64";
	seed?: number;
	n?: number;
	promptOptimizer?: boolean;
}

interface MiniMaxSubjectReference {
	type: "character";
	image_file: string;
}

interface MiniMaxImageGenerationRequest {
	model: string;
	prompt: string;
	subject_reference?: MiniMaxSubjectReference[];
	aspect_ratio?: MiniMaxImagesOptions["aspectRatio"];
	width?: number;
	height?: number;
	response_format?: MiniMaxImagesOptions["responseFormat"];
	seed?: number;
	n?: number;
	prompt_optimizer?: boolean;
}

interface MiniMaxImageGenerationResponse {
	id?: string;
	data?: {
		image_urls?: string[];
		image_base64?: string[];
	};
	metadata?: {
		success_count?: number | string;
		failed_count?: number | string;
	};
	base_resp?: {
		status_code?: number;
		status_msg?: string;
	};
}

export const generateImagesMiniMax: ImagesFunction<"minimax-images", MiniMaxImagesOptions> = async (
	model: ImagesModel<"minimax-images">,
	context: ImagesContext,
	options?: MiniMaxImagesOptions,
) => {
	const output: AssistantImages = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "stop",
		timestamp: Date.now(),
	};

	try {
		const apiKey = options?.apiKey;
		if (!apiKey) {
			throw new Error(`No API key for provider: ${model.provider}`);
		}
		if (options?.signal?.aborted) {
			throw new Error("Request was aborted");
		}

		let payload = buildPayload(model, context, options);
		const nextPayload = await options?.onPayload?.(payload, model);
		if (nextPayload !== undefined) {
			payload = nextPayload as MiniMaxImageGenerationRequest;
		}

		const response = await fetch(model.baseUrl, {
			method: "POST",
			headers: buildHeaders(apiKey, model.headers, options?.headers),
			body: JSON.stringify(payload),
			signal: createRequestSignal(options),
		});
		await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);

		const responseText = await response.text();
		const responseBody = parseResponseBody(responseText);
		const statusCode = responseBody.base_resp?.status_code;
		if (!response.ok || (statusCode !== undefined && statusCode !== 0)) {
			throw new Error(getErrorMessage(response, responseBody));
		}

		output.responseId = responseBody.id;
		for (const imageUrl of responseBody.data?.image_urls ?? []) {
			output.output.push(await imageUrlToContent(imageUrl, options));
		}
		for (const imageBase64 of responseBody.data?.image_base64 ?? []) {
			output.output.push(base64ToContent(imageBase64));
		}

		if (output.output.length === 0) {
			throw new Error("MiniMax image generation returned no images");
		}

		return output;
	} catch (error) {
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = error instanceof Error ? error.message : String(error);
		return output;
	}
};

function buildPayload(
	model: ImagesModel<"minimax-images">,
	context: ImagesContext,
	options?: MiniMaxImagesOptions,
): MiniMaxImageGenerationRequest {
	const subjectReference = context.input
		.filter((item): item is ImageContent => item.type === "image")
		.map((item) => ({
			type: "character" as const,
			image_file: `data:${item.mimeType};base64,${item.data}`,
		}));

	const prompt = context.input
		.filter((item) => item.type === "text")
		.map((item) => sanitizeSurrogates(item.text).trim())
		.filter(Boolean)
		.join("\n");
	if (!prompt) {
		throw new Error("MiniMax image generation requires a text prompt");
	}
	if (options?.n !== undefined && (!Number.isSafeInteger(options.n) || options.n < 1 || options.n > MAX_IMAGE_COUNT)) {
		throw new Error(`MiniMax image generation n must be an integer between 1 and ${MAX_IMAGE_COUNT}`);
	}

	return {
		model: model.id,
		prompt,
		...(subjectReference.length > 0 ? { subject_reference: subjectReference } : {}),
		...(options?.aspectRatio !== undefined ? { aspect_ratio: options.aspectRatio } : {}),
		...(options?.width !== undefined ? { width: options.width } : {}),
		...(options?.height !== undefined ? { height: options.height } : {}),
		...(options?.responseFormat !== undefined ? { response_format: options.responseFormat } : {}),
		...(options?.seed !== undefined ? { seed: options.seed } : {}),
		...(options?.n !== undefined ? { n: options.n } : {}),
		...(options?.promptOptimizer !== undefined ? { prompt_optimizer: options.promptOptimizer } : {}),
	};
}

function buildHeaders(
	apiKey: string,
	modelHeaders?: Record<string, string>,
	optionHeaders?: Record<string, string>,
): Headers {
	const headers = new Headers({
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	});
	for (const [name, value] of Object.entries(modelHeaders ?? {})) headers.set(name, value);
	for (const [name, value] of Object.entries(optionHeaders ?? {})) headers.set(name, value);
	return headers;
}

function createRequestSignal(options?: MiniMaxImagesOptions): AbortSignal | undefined {
	if (options?.timeoutMs === undefined) return options?.signal;
	if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
		throw new Error(`Invalid timeoutMs: ${String(options.timeoutMs)}`);
	}
	const timeoutSignal = AbortSignal.timeout(Math.floor(options.timeoutMs));
	return options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
}

function parseResponseBody(responseText: string): MiniMaxImageGenerationResponse {
	if (!responseText) return {};
	try {
		return JSON.parse(responseText) as MiniMaxImageGenerationResponse;
	} catch {
		throw new Error("MiniMax image generation returned invalid JSON");
	}
}

function getErrorMessage(response: Response, responseBody: MiniMaxImageGenerationResponse): string {
	const statusMessage = responseBody.base_resp?.status_msg?.trim();
	if (statusMessage) return `MiniMax image generation failed: ${statusMessage}`;
	const statusCode = responseBody.base_resp?.status_code;
	if (statusCode !== undefined) return `MiniMax image generation failed with status code ${statusCode}`;
	return `MiniMax image generation failed with HTTP ${response.status}`;
}

async function imageUrlToContent(imageUrl: string, options?: MiniMaxImagesOptions): Promise<ImageContent> {
	if (imageUrl.startsWith("data:")) return base64ToContent(imageUrl);
	const url = assertSafeImageUrl(imageUrl);

	const response = await fetch(url, { redirect: "error", signal: createRequestSignal(options) });
	if (!response.ok) {
		throw new Error(`Failed to download generated image: HTTP ${response.status}`);
	}
	const bytes = await readBoundedImageResponse(response);
	const mimeType = detectImageMimeType(bytes);
	if (!mimeType) throw new Error("MiniMax image generation returned an unrecognized image payload");
	return {
		type: "image",
		mimeType,
		data: Buffer.from(bytes).toString("base64"),
	};
}

function base64ToContent(value: string): ImageContent {
	const dataUrlMatch = value.match(/^data:([^;,]+);base64,(.+)$/s);
	const data = (dataUrlMatch?.[2] ?? value).replace(/\s+/g, "");
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
		throw new Error("MiniMax image generation returned invalid base64 image data");
	}
	const bytes = Buffer.from(data, "base64");
	if (bytes.length === 0 || bytes.length > MAX_GENERATED_IMAGE_BYTES) {
		throw new Error(`MiniMax image generation returned an image outside the ${MAX_GENERATED_IMAGE_BYTES}-byte limit`);
	}
	const mimeType = detectImageMimeType(bytes);
	if (!mimeType) throw new Error("MiniMax image generation returned an unrecognized image payload");
	return {
		type: "image",
		mimeType,
		data,
	};
}

function assertSafeImageUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("MiniMax image generation returned an invalid image URL");
	}
	if (url.protocol !== "https:" || url.username || url.password) {
		throw new Error("MiniMax image generation returned an unsafe image URL");
	}
	if (isBlockedLiteralAddress(url.hostname)) {
		throw new Error("MiniMax image generation returned a private image URL");
	}
	return url;
}

function isBlockedLiteralAddress(hostname: string): boolean {
	if (!isIP(hostname)) return false;
	const normalized = hostname.toLowerCase();
	if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || /^f[cd][0-9a-f:]*$/i.test(normalized)) {
		return true;
	}
	if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;
	const [first, second] = hostname.split(".").map(Number);
	return first === 0
		|| first === 10
		|| first === 127
		|| (first === 169 && second === 254)
		|| (first === 172 && second >= 16 && second <= 31)
		|| (first === 192 && second === 168)
		|| first >= 224;
}

async function readBoundedImageResponse(response: Response): Promise<Buffer> {
	const header = response.headers.get("content-length");
	if (header && (!/^\d+$/.test(header) || Number(header) > MAX_GENERATED_IMAGE_BYTES)) {
		throw new Error(`MiniMax image generation returned an image above the ${MAX_GENERATED_IMAGE_BYTES}-byte limit`);
	}
	if (!response.body) throw new Error("MiniMax image generation returned an empty image response");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > MAX_GENERATED_IMAGE_BYTES) {
				throw new Error(`MiniMax image generation returned an image above the ${MAX_GENERATED_IMAGE_BYTES}-byte limit`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks);
}

function detectImageMimeType(bytes: Uint8Array): string | undefined {
	if (bytes.length >= 8 && bytes.subarray(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) return "image/png";
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (bytes.length >= 6 && (Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF87a" || Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF89a")) return "image/gif";
	if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
	return undefined;
}

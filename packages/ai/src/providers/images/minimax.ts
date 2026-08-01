import type {
	AssistantImages,
	ImageContent,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
} from "../../types.ts";
import { headersToRecord } from "../../utils/headers.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";

export interface MiniMaxImagesOptions extends ImagesOptions {
	aspectRatio?: "1:1" | "16:9" | "4:3" | "3:2" | "2:3" | "3:4" | "9:16" | "21:9";
	width?: number;
	height?: number;
	responseFormat?: "url" | "base64";
	seed?: number;
	n?: number;
	promptOptimizer?: boolean;
}

interface MiniMaxImageGenerationRequest {
	model: string;
	prompt: string;
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
	if (context.input.some((item) => item.type === "image")) {
		throw new Error(`Model ${model.id} does not support image input`);
	}

	const prompt = context.input
		.filter((item) => item.type === "text")
		.map((item) => sanitizeSurrogates(item.text).trim())
		.filter(Boolean)
		.join("\n");
	if (!prompt) {
		throw new Error("MiniMax image generation requires a text prompt");
	}

	return {
		model: model.id,
		prompt,
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
	const url = new URL(imageUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("MiniMax image generation returned an unsupported image URL");
	}

	const response = await fetch(url, { signal: createRequestSignal(options) });
	if (!response.ok) {
		throw new Error(`Failed to download generated image: HTTP ${response.status}`);
	}
	const data = Buffer.from(await response.arrayBuffer()).toString("base64");
	const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
	return {
		type: "image",
		mimeType: contentType || detectImageMimeType(data),
		data,
	};
}

function base64ToContent(value: string): ImageContent {
	const dataUrlMatch = value.match(/^data:([^;,]+);base64,(.+)$/s);
	const data = (dataUrlMatch?.[2] ?? value).replace(/\s+/g, "");
	return {
		type: "image",
		mimeType: dataUrlMatch?.[1] ?? detectImageMimeType(data),
		data,
	};
}

function detectImageMimeType(data: string): string {
	if (data.startsWith("iVBORw0KGgo")) return "image/png";
	if (data.startsWith("R0lGOD")) return "image/gif";
	if (data.startsWith("UklGR")) return "image/webp";
	return "image/jpeg";
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.ts";
import { streamAnthropic } from "../src/providers/anthropic.ts";
import { transformMessages } from "../src/providers/transform-messages.ts";
import type { Context, Message, Model } from "../src/types.ts";

interface CapturedRequest {
	body: Record<string, unknown>;
}

function getMiniMaxM3(baseUrl: string): Model<"anthropic-messages"> {
	const model = getModel("minimax", "MiniMax-M3");
	if (!model) {
		throw new Error("MiniMax-M3 is not registered");
	}
	return { ...model, baseUrl };
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function writeEmptySseResponse(response: ServerResponse): void {
	response.writeHead(200, { "content-type": "text/event-stream" });
	response.end();
}

async function captureRequest(context: Context): Promise<CapturedRequest> {
	let capturedRequest: CapturedRequest | undefined;
	const server = createServer(async (request, response) => {
		capturedRequest = { body: await readRequestBody(request) };
		writeEmptySseResponse(response);
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;

	try {
		const stream = streamAnthropic(getMiniMaxM3(`http://127.0.0.1:${address.port}`), context, {
			apiKey: "test-key",
			cacheRetention: "none",
		});
		for await (const event of stream) {
			if (event.type === "done" || event.type === "error") break;
		}
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}

	if (!capturedRequest) {
		throw new Error("Anthropic-compatible request was not captured");
	}
	return capturedRequest;
}

describe("MiniMax M3 video input", () => {
	it("sends base64 video blocks through the Anthropic-compatible request", async () => {
		const request = await captureRequest({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe this clip" },
						{ type: "video", data: "dmlkZW8=", mimeType: "video/mp4" },
					],
					timestamp: Date.now(),
				},
			],
		});

		const messages = request.body.messages as Array<{ content: unknown }>;
		expect(messages).toHaveLength(1);
		expect(messages[0].content).toContainEqual({
			type: "video",
			source: { type: "base64", media_type: "video/mp4", data: "dmlkZW8=" },
		});
	});

	it("downgrades only video for image-capable models that do not support video", () => {
		const m3 = getMiniMaxM3("https://api.minimax.io/anthropic");
		const imageOnlyModel: Model<"anthropic-messages"> = {
			...m3,
			id: "image-only-test-model",
			input: ["text", "image"],
		};
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
					{ type: "video", data: "dmlkZW8=", mimeType: "video/mp4" },
				],
				timestamp: Date.now(),
			},
		];

		const transformed = transformMessages(messages, imageOnlyModel);
		expect(transformed[0]).toMatchObject({
			role: "user",
			content: [
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
				{ type: "text", text: "(video omitted: model does not support video)" },
			],
		});
	});
});

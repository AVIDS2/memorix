import { afterEach, describe, expect, it, vi } from "vitest";
import { getImageModel, getImageModels } from "../src/image-models.ts";
import { generateImages } from "../src/images.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("MiniMax images", () => {
	it("registers global and China image models", () => {
		const globalModel = getImageModel("minimax", "image-01");
		const chinaModel = getImageModel("minimax-cn", "image-01-live");

		expect(globalModel).toMatchObject({
			api: "minimax-images",
			provider: "minimax",
			baseUrl: "https://api.minimax.io/v1/image_generation",
			input: ["text"],
			output: ["image"],
		});
		expect(chinaModel).toMatchObject({
			api: "minimax-images",
			provider: "minimax-cn",
			baseUrl: "https://api.minimaxi.com/v1/image_generation",
		});
		expect(getImageModels("minimax").map((model) => model.id)).toEqual(["image-01", "image-01-live"]);
	});

	it("sends supported text-to-image fields and parses base64 output", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					id: "image-request-1",
					data: { image_base64: ["iVBORw0KGgo="] },
					metadata: { success_count: 1, failed_count: 0 },
					base_resp: { status_code: 0, status_msg: "success" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json", "X-Request-Id": "image-request-1" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);
		const onResponse = vi.fn();

		const output = await generateImages(
			getImageModel("minimax", "image-01"),
			{ input: [{ type: "text", text: "Generate a blue square" }] },
			{
				apiKey: "test-key",
				aspectRatio: "1:1",
				width: 1024,
				height: 1024,
				responseFormat: "base64",
				seed: 42,
				n: 1,
				promptOptimizer: true,
				onResponse,
			},
		);

		expect(output).toMatchObject({
			responseId: "image-request-1",
			stopReason: "stop",
			output: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, request] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.minimax.io/v1/image_generation");
		expect(request?.method).toBe("POST");
		expect(new Headers(request?.headers).get("authorization")).toBe("Bearer test-key");
		expect(JSON.parse(String(request?.body))).toEqual({
			model: "image-01",
			prompt: "Generate a blue square",
			aspect_ratio: "1:1",
			width: 1024,
			height: 1024,
			response_format: "base64",
			seed: 42,
			n: 1,
			prompt_optimizer: true,
		});
		expect(onResponse).toHaveBeenCalledWith(
			{ status: 200, headers: expect.objectContaining({ "x-request-id": "image-request-1" }) },
			expect.objectContaining({ id: "image-01" }),
		);
	});

	it("downloads URL output from the China endpoint", async () => {
		const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const fetchMock = vi.fn(async (input: string | URL | Request) => {
			const url = input.toString();
			if (url === "https://api.minimaxi.com/v1/image_generation") {
				return new Response(
					JSON.stringify({
						data: { image_urls: ["https://images.example.test/generated.png"] },
						base_resp: { status_code: 0 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response(imageBytes, { status: 200, headers: { "Content-Type": "image/png" } });
		});
		vi.stubGlobal("fetch", fetchMock);

		const output = await generateImages(getImageModel("minimax-cn", "image-01-live"), {
			input: [{ type: "text", text: "Generate a city skyline" }],
		}, { apiKey: "test-key" });

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(output.stopReason).toBe("stop");
		expect(output.output[0]).toEqual({
			type: "image",
			mimeType: "image/png",
			data: Buffer.from(imageBytes).toString("base64"),
		});
	});

	it("returns API errors without throwing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(JSON.stringify({ base_resp: { status_code: 2013, status_msg: "Invalid input" } }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);

		const output = await generateImages(
			getImageModel("minimax", "image-01"),
			{ input: [{ type: "text", text: "Generate an image" }] },
			{ apiKey: "test-key" },
		);

		expect(output.stopReason).toBe("error");
		expect(output.errorMessage).toBe("MiniMax image generation failed: Invalid input");
	});

	it("returns an aborted result for an aborted signal", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();
		controller.abort();

		const output = await generateImages(
			getImageModel("minimax", "image-01"),
			{ input: [{ type: "text", text: "Generate an image" }] },
			{ apiKey: "test-key", signal: controller.signal },
		);

		expect(output.stopReason).toBe("aborted");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

import { mock } from "bun:test";

mock.module("obsidian", () => ({
	requestUrl: async (
		request: string | { url: string; headers?: Record<string, string> },
	) => {
		const url = typeof request === "string" ? request : request.url;
		const headers =
			typeof request === "string" ? undefined : request.headers;

		const response = await fetch(url, { headers });
		if (!response.ok) {
			throw new Error(
				`Request failed: ${response.status} ${response.statusText}`,
			);
		}

		return { json: await response.json() };
	},
}));

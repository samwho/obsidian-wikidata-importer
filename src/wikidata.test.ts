import { describe, expect, test } from "bun:test";
import { Entity, EntityNotFoundError } from "./wikidata";

const DEFAULT_OPTIONS = {
	language: "mul,en",
	ignoreCategories: true,
	ignoreWikipediaPages: true,
	ignoreIDs: true,
	ignorePropertiesWithTimeRanges: true,
	// biome-ignore lint/suspicious/noTemplateCurlyInString: intentional
	internalLinkPrefix: "db/${label}",
	spaceReplacement: "",
};

describe("Entity", () => {
	test("searches Wikidata using configured languages", async () => {
		const results = await Entity.search("Douglas Adams", {
			language: "mul,en",
		});

		expect(results.some((entity) => entity.id === "Q42")).toBe(true);
	});

	test("resolves non-scholarly entity properties from live SPARQL services", async () => {
		const properties =
			await Entity.fromId("Q42").getProperties(DEFAULT_OPTIONS);

		expect(properties["instance of"]).toContain("[[db/human]]");
		expect(properties["date of birth"]).toContain("1952-03-11T00:00:00Z");
		expect(properties.height).toContain(1.96);
		expect(properties.DOI).toBeUndefined();
	});

	test("resolves scholarly entity properties from QLever", async () => {
		const properties =
			await Entity.fromId("Q4781761").getProperties(DEFAULT_OPTIONS);

		expect(properties.DOI).toContain("10.1371/JOURNAL.PCBI.1002803");
		expect(properties.title).toContain("Approximate Bayesian computation");
		expect(properties["publication date"]).toContain(
			"2013-01-01T00:00:00Z",
		);
		expect(properties["instance of"]).toContain("[[db/scholarly article]]");
	});

	test("throws when a Wikidata entity does not exist", async () => {
		await expect(
			Entity.fromId("Q34213821738927189371289371289").getProperties(
				DEFAULT_OPTIONS,
			),
		).rejects.toThrow(EntityNotFoundError);
	});

	test("uses one preferred QLever label for multilingual property labels", async () => {
		const properties = await Entity.fromId("Q42").getProperties({
			...DEFAULT_OPTIONS,
			language: "de,en",
		});

		expect(properties["Höhe"]).toContain(1.96);
		expect(properties.height).toBeUndefined();
	});
});

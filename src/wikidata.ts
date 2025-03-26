import { requestUrl } from "obsidian";

export type Value = string | number | boolean;
export type Properties = { [key: string]: Array<Value> };

export interface SearchResponse {
	search: Entity[];
	success: number;
}

export interface GetPropertiesOptions {
	language: string;
	ignoreCategories: boolean;
	ignoreWikipediaPages: boolean;
	ignoreIDs: boolean;
	ignorePropertiesWithTimeRanges: boolean;
	internalLinkPrefix: string;
	spaceReplacement: string;
}

export interface SearchOptions {
	language: string;
}

function isString(type: string | null): boolean {
	if (!type) return false;
	return (
		type === "http://www.w3.org/2001/XMLSchema#string" ||
		type === "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
	);
}

function isInteger(type: string | null): boolean {
	if (!type) return false;
	return type === "http://www.w3.org/2001/XMLSchema#integer";
}

function isDecimal(type: string | null): boolean {
	if (!type) return false;
	return type === "http://www.w3.org/2001/XMLSchema#decimal";
}

function isDate(type: string | null): boolean {
	if (!type) return false;
	return type === "http://www.w3.org/2001/XMLSchema#dateTime";
}

export class Entity {
	id: string;
	label?: string;
	description?: string;

	constructor(id: string, label?: string, description?: string) {
		this.id = id;
		this.label = label;
		this.description = description;
	}

	static fromJson(json: any): Entity {
		return new Entity(json.id, json.label, json.description);
	}

	static fromId(id: string): Entity {
		return new Entity(id);
	}

	static async search(query: string, opts: SearchOptions): Promise<Entity[]> {
		if (!query || query.length === 0) return [];

		const url =
			`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=${opts.language}&uselang=${opts.language}&type=item&limit=10&search=` +
			encodeURIComponent(query);
		console.log(url);
		const response = await requestUrl(url);
		const json: SearchResponse = response.json;
		return json.search.map(Entity.fromJson);
	}

	static replaceCharacters(
		str: string,
		searchString: string,
		replaceString: string
	) {
		let result = str;

		for (let i = 0; i < searchString.length; i++) {
			const searchChar = searchString[i];
			const replaceChar =
				replaceString[Math.min(i, replaceString.length - 1)];

			result = result.replace(
				new RegExp("\\" + searchChar, "g"),
				replaceChar
			);
		}

		return result;
	}

	static buildLink(link: string, label: string, id: string): string {
		label = Entity.replaceCharacters(label, '*/:#?<>"', "_");
		link = link.replace(/\$\{label\}/g, label).replace(/\$\{id\}/g, id);
		return link;
	}

	// TODO: incorporate https://query.wikidata.org/#SELECT%20%3FwdLabel%20%3Fps_Label%20%3FwdpqLabel%20%3Fpq_Label%20%7B%0A%20%20VALUES%20%28%3Fcompany%29%20%7B%28wd%3AQ5284%29%7D%0A%20%20%0A%20%20%3Fcompany%20%3Fp%20%3Fstatement%20.%0A%20%20%3Fstatement%20%3Fps%20%3Fps_%20.%0A%20%20%0A%20%20%3Fwd%20wikibase%3Aclaim%20%3Fp.%0A%20%20%3Fwd%20wikibase%3AstatementProperty%20%3Fps.%0A%20%20%0A%20%20OPTIONAL%20%7B%0A%20%20%3Fstatement%20%3Fpq%20%3Fpq_%20.%0A%20%20%3Fwdpq%20wikibase%3Aqualifier%20%3Fpq%20.%0A%20%20%7D%0A%20%20%0A%20%20SERVICE%20wikibase%3Alabel%20%7B%20bd%3AserviceParam%20wikibase%3Alanguage%20%22en%22%20%7D%0A%7D%20ORDER%20BY%20%3Fwd%20%3Fstatement%20%3Fps_
	async getProperties(opts: GetPropertiesOptions): Promise<Properties> {
		let query = `
			SELECT ?propertyLabel ?value ?valueLabel ?valueType ?normalizedValue ?description WHERE {
				wd:${this.id} ?propUrl ?value .
				?property wikibase:directClaim ?propUrl .
				OPTIONAL { wd:${this.id} schema:description ?description . FILTER (LANG(?description) = "${opts.language}") }
				OPTIONAL {
					?statement psn:P31 ?normalizedValue .
					?normalizedValue wikibase:quantityUnit ?unit .
				}
				BIND(DATATYPE(?value) AS ?valueType) .
		`;

		if (opts.ignorePropertiesWithTimeRanges) {
			query += `
				MINUS { ?value p:P580 ?startDateStatement. }
				MINUS { ?value p:P582 ?endDateStatement. }
				MINUS { ?value p:P585 ?pointInTimeStatement. }
			`;
		}

		query += `
				SERVICE wikibase:label {
					bd:serviceParam wikibase:language "[AUTO_LANGUAGE],${opts.language}" .
				}
			}
		`;

		const url =
			"https://query.wikidata.org/sparql?query=" +
			encodeURIComponent(query) +
			"&format=json";

		const response = await requestUrl(url);
		const json = response.json;
		const results = json.results.bindings;

		const ret: Properties = {};

		results.forEach((r: any) => {
			let key: string = r.propertyLabel.value;
			const value: string = r.value.value;
			const normalizedValue: string | null = r.normalizedValue
				? r.normalizedValue.value
				: null;
			const type: string | null = r.valueType ? r.valueType.value : null;
			const valueLabel: string | null = r.valueLabel
				? r.valueLabel.value
				: null;

			if (
				opts.ignoreCategories &&
				valueLabel &&
				valueLabel.startsWith("Category:")
			) {
				return;
			}

			if (
				opts.ignoreWikipediaPages &&
				valueLabel &&
				valueLabel.startsWith("Wikipedia:")
			) {
				return;
			}

			if (opts.ignoreIDs && valueLabel && key.match(/\bID\b/)) {
				return;
			}

			if (opts.spaceReplacement && opts.spaceReplacement.length > 0) {
				key = key.replace(/[^\p{L}]/gu, opts.spaceReplacement);
			}

			let toAdd: Value | null = valueLabel;

			if (normalizedValue) {
				toAdd = normalizedValue;
			} else if (isDate(type)) {
				toAdd = value;
			} else if (isDecimal(type)) {
				toAdd = parseFloat(value);
			} else if (isInteger(type)) {
				toAdd = parseInt(value);
			} else if (isString(type)) {
				toAdd = value;
			} else if (value.match(/Q\d+$/) && valueLabel) {
				let id = value.match(/\d+$/)!;
				var label = Entity.buildLink(
					opts.internalLinkPrefix,
					valueLabel,
					id[0]
				);
				toAdd = `[[${label}]]`;
			}

			if (toAdd === null) {
				return;
			}

			if (ret[key]) {
				ret[key].push(toAdd);
			} else {
				ret[key] = [toAdd];
			}
		});

		return ret;
	}
}

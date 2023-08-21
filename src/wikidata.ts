import { requestUrl } from "obsidian";

export type Value = string | number | boolean;
export type Properties = { [key: string]: Array<Value> };

export interface SearchResponse {
	search: Entity[];
	success: number;
}

export interface GetPropertiesOptions {
	ignoreCategories: boolean;
	ignorePropertiesWithTimeRanges: boolean;
	internalLinkPrefix: string;
}

function isString(type: string): boolean {
	return (
		type === "http://www.w3.org/2001/XMLSchema#string" ||
		type === "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
	);
}

function isInteger(type: string): boolean {
	return type === "http://www.w3.org/2001/XMLSchema#integer";
}

function isDecimal(type: string): boolean {
	return type === "http://www.w3.org/2001/XMLSchema#decimal";
}

function isDate(type: string): boolean {
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

	static async search(query: string): Promise<Entity[]> {
		const url =
			"https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=10&search=" +
			encodeURIComponent(query);
		const response = await requestUrl(url);
		const json: SearchResponse = await response.json();
		return json.search.map(Entity.fromJson);
	}

	async getProperties(opts: GetPropertiesOptions): Promise<Properties> {
		let query = `
			SELECT ?propertyLabel ?value ?valueLabel ?valueType ?description WHERE {
				wd:${this.id} ?propUrl ?value .
				?property wikibase:directClaim ?propUrl .
				OPTIONAL { wd:${this.id} schema:description ?description . FILTER (LANG(?description) = "en") }
				BIND(DATATYPE(?value) AS ?valueType) .
		`;

		if (opts.ignorePropertiesWithTimeRanges) {
			query += `
				MINUS { ?value p:P580 ?startDateStatement. }
				MINUS { ?value p:P582 ?endDateStatement. }
			`;
		}

		query += `
				SERVICE wikibase:label {
					bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en" .
				}
			}
		`;

		const url =
			"https://query.wikidata.org/sparql?query=" +
			encodeURIComponent(query) +
			"&format=json";

		const response = await requestUrl(url);
		const json = await response.json();
		const results = json.results.bindings;

		const ret: Properties = {};

		results.forEach((r: any) => {
			const key = r.propertyLabel.value;
			const value = r.value.value;
			const type = r.valueType ? r.valueType.value : null;

			var valueLabel = r.valueLabel ? r.valueLabel.value : null;
			if (
				opts.ignoreCategories &&
				valueLabel &&
				valueLabel.startsWith("Category:")
			) {
				return;
			}

			if (isDate(type)) {
				valueLabel = value;
			} else if (isDecimal(type)) {
				valueLabel = parseFloat(value);
			} else if (isInteger(type)) {
				valueLabel = parseInt(value);
			} else if (isString(type)) {
				valueLabel = value;
			} else if (value.match(/Q\d+$/) && valueLabel) {
				valueLabel = `[[${opts.internalLinkPrefix}${valueLabel}]]`;
			}

			if (ret[key]) {
				ret[key].push(valueLabel);
			} else {
				ret[key] = [valueLabel];
			}
		});

		return ret;
	}
}

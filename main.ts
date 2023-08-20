import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";

interface Settings {
	entityIdKey: string;
	internalLinkPrefix: string;
	ignoreCategories: boolean;
	ignorePropertiesWithTimeRanges: boolean;
	overwriteExistingProperties: boolean;
}

const DEFAULT_SETTINGS: Settings = {
	entityIdKey: "wikidata entity id",
	internalLinkPrefix: "db/",
	ignoreCategories: true,
	ignorePropertiesWithTimeRanges: true,
	overwriteExistingProperties: false,
};

interface WikidataEntity {
	id: string;
	properties: { [key: string]: any };
}

export default class WikidataImporter extends Plugin {
	settings: Settings;

	isString(type: string): boolean {
		return (
			type === "http://www.w3.org/2001/XMLSchema#string" ||
			type === "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
		);
	}

	isInteger(type: string): boolean {
		return type === "http://www.w3.org/2001/XMLSchema#integer";
	}

	isDecimal(type: string): boolean {
		return type === "http://www.w3.org/2001/XMLSchema#decimal";
	}

	isDate(type: string): boolean {
		return type === "http://www.w3.org/2001/XMLSchema#dateTime";
	}

	async getEntity(entityId: string): Promise<WikidataEntity> {
		let sparqlQuery = `
			SELECT ?propertyLabel ?value ?valueLabel ?valueType ?description WHERE {
				wd:${entityId} ?propUrl ?value .
				?property wikibase:directClaim ?propUrl .
				OPTIONAL { wd:${entityId} schema:description ?description . FILTER (LANG(?description) = "en") }
				BIND(DATATYPE(?value) AS ?valueType) .
		`;

		if (this.settings.ignorePropertiesWithTimeRanges) {
			sparqlQuery += `
				MINUS { ?value p:P580 ?startDateStatement. }
				MINUS { ?value p:P582 ?endDateStatement. }
			`;
		}

		sparqlQuery += `
				SERVICE wikibase:label {
					bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en" .
				}
			}
		`;

		const url =
			"https://query.wikidata.org/sparql?query=" +
			encodeURIComponent(sparqlQuery) +
			"&format=json";

		const response = await fetch(url);
		const json = await response.json();
		const results = json.results.bindings;

		const ret: { [key: string]: any } = {};

		results.forEach((r: any) => {
			const key = r.propertyLabel.value;
			const value = r.value.value;
			const type = r.valueType ? r.valueType.value : null;

			var valueLabel = r.valueLabel ? r.valueLabel.value : null;
			if (
				this.settings.ignoreCategories &&
				valueLabel &&
				valueLabel.startsWith("Category:")
			) {
				return;
			}

			if (this.isDate(type)) {
				valueLabel = value;
			} else if (this.isDecimal(type)) {
				valueLabel = parseFloat(value);
			} else if (this.isInteger(type)) {
				valueLabel = parseInt(value);
			} else if (this.isString(type)) {
				valueLabel = value;
			} else if (value.match(/Q\d+$/) && valueLabel) {
				valueLabel = `[[${this.settings.internalLinkPrefix}${valueLabel}]]`;
			}

			if (ret[key]) {
				ret[key].push(valueLabel);
			} else {
				ret[key] = [valueLabel];
			}
		});

		return {
			id: entityId,
			properties: ret,
		};
	}

	async importProperties() {
		let file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file");
			return;
		}

		let frontmatter = null;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			frontmatter = fm;
		});

		let entityId = frontmatter![this.settings.entityIdKey];
		if (!entityId || !entityId.startsWith("Q")) {
			new Notice(
				"To import Wikidata properties, you must define a Wikidata entity ID in the frontmatter"
			);
			return;
		}

		let loading = new Notice("Loading properties from Wikidata...");

		let entity: WikidataEntity | null = null;
		try {
			entity = await this.getEntity(entityId);
		} catch (e) {
			new Notice(
				`Error fetching properties for entity ${entityId}: ${e}`
			);
			return;
		} finally {
			loading.hide();
		}

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			let imported = 0;
			let overwritten = 0;
			for (const [key, value] of Object.entries(entity!.properties)) {
				if (this.settings.overwriteExistingProperties) {
					if (frontmatter[key]) {
						overwritten++;
					}
					frontmatter[key] = value.length === 1 ? value[0] : value;
					imported++;
				} else if (!frontmatter[key]) {
					frontmatter[key] = value.length === 1 ? value[0] : value;
					imported++;
				}
			}

			let message = `Imported ${imported} properties from Wikidata entity ${entityId}`;
			if (overwritten > 0) {
				message += ` (overwrote ${overwritten} existing properties)`;
			}
			new Notice(message);
		});
	}

	async onload() {
		await this.loadSettings();

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "import-properties-for-active-file",
			name: "Import Properties for active file",
			callback: this.importProperties.bind(this),
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: WikidataImporter;

	constructor(app: App, plugin: WikidataImporter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Wikidata Entity ID Key")
			.setDesc("The frontmatter key to use for the Wikidata entity ID")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.entityIdKey)
					.setValue(this.plugin.settings.entityIdKey)
					.onChange(async (value) => {
						this.plugin.settings.entityIdKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Internal Link Prefix")
			.setDesc(
				"The prefix to use for internal links to Wikidata entities"
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.internalLinkPrefix)
					.setValue(this.plugin.settings.internalLinkPrefix)
					.onChange(async (value) => {
						this.plugin.settings.internalLinkPrefix = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ignore Categories")
			.setDesc(
				"If checked, categories will not be imported as properties"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ignoreCategories)
					.onChange(async (value) => {
						this.plugin.settings.ignoreCategories = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ignore Properties with Time Ranges")
			.setDesc(
				"If checked, properties with time ranges will not be imported"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.ignorePropertiesWithTimeRanges
					)
					.onChange(async (value) => {
						this.plugin.settings.ignorePropertiesWithTimeRanges =
							value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Overwrite Existing Properties")
			.setDesc(
				"If checked, existing properties will be overwritten when importing"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.overwriteExistingProperties)
					.onChange(async (value) => {
						this.plugin.settings.overwriteExistingProperties =
							value;
						await this.plugin.saveSettings();
					})
			);
	}
}

import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	SuggestModal,
	requestUrl,
} from "obsidian";

import { Entity, Properties } from "./src/wikidata";

interface WikidataImporterSettings {
	entityIdKey: string;
	internalLinkPrefix: string;
	ignoreCategories: boolean;
	ignorePropertiesWithTimeRanges: boolean;
	overwriteExistingProperties: boolean;
}

const DEFAULT_SETTINGS: WikidataImporterSettings = {
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

class WikidataEntitySuggestModal extends SuggestModal<WikidataEntity> {
	async getSuggestions(query: string): Promise<WikidataEntity[]> {
		const url =
			"https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=10&search=" +
			encodeURIComponent(query);
		const response = await requestUrl(url);
		const json = await response.json();
		return json.search;
	}

	onChooseSuggestion(item: WikidataEntity, evt: MouseEvent | KeyboardEvent) {
		throw new Error("Method not implemented.");
	}

	constructor(app: App, title: string) {
		super(app);
		this.setPlaceholder("Search for a Wikidata entity");
	}

	renderSuggestion(
		entity: WikidataEntity,
		el: HTMLElement,
	): void {
		el.setText(entity.id);
	}
}

export default class WikidataImporterPlugin extends Plugin {
	settings: WikidataImporterSettings;

	async importProperties() {
		let file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file");
			return;
		}

		let frontmatter =
			this.app.metadataCache.getFileCache(file)?.frontmatter || {};

		let entityId = frontmatter[this.settings.entityIdKey];
		if (!entityId || !entityId.startsWith("Q")) {
			new Notice(
				"To import Wikidata properties, you must define a Wikidata entity ID in the frontmatter"
			);
			return;
		}

		let loading = new Notice("Loading properties from Wikidata...");

		let entity = Entity.fromId(entityId);
		let properties: Properties;
		try {
			properties = await entity.getProperties({
				ignoreCategories: this.settings.ignoreCategories,
				ignorePropertiesWithTimeRanges: this.settings
					.ignorePropertiesWithTimeRanges,
				internalLinkPrefix: this.settings.internalLinkPrefix,
			});
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
			for (const [key, value] of Object.entries(properties)) {
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

		this.addCommand({
			id: "import-properties-for-active-file",
			name: "Import properties for active file",
			editorCallback: this.importProperties.bind(this),
		});

		this.addSettingTab(new WikidataImporterSettingsTab(this.app, this));
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

class WikidataImporterSettingsTab extends PluginSettingTab {
	plugin: WikidataImporterPlugin;

	constructor(app: App, plugin: WikidataImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Wikidata entity ID key")
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
			.setName("Internal link prefix")
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
			.setName("Ignore categories")
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
			.setName("Ignore properties with time ranges")
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
			.setName("Overwrite existing properties")
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

import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	SuggestModal,
	TFile,
} from "obsidian";

import { Entity } from "./src/wikidata";

interface WikidataImporterSettings {
	entityIdKey: string;
	internalLinkPrefix: string;
	ignoreCategories: boolean;
	ignoreWikipediaPages: boolean;
	ignoreIDs: boolean;
	ignorePropertiesWithTimeRanges: boolean;
	overwriteExistingProperties: boolean;
}

const DEFAULT_SETTINGS: WikidataImporterSettings = {
	entityIdKey: "wikidata entity id",
	internalLinkPrefix: "db/${label}",
	ignoreCategories: true,
	ignoreWikipediaPages: true,
	ignoreIDs: true,
	ignorePropertiesWithTimeRanges: true,
	overwriteExistingProperties: false,
};

async function syncEntityToFile(
	plugin: WikidataImporterPlugin,
	entity: Entity,
	file: TFile
) {
	let frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter) {
		frontmatter = {};
	}

	let properties = await entity.getProperties({
		ignoreCategories: plugin.settings.ignoreCategories,
		ignoreWikipediaPages: plugin.settings.ignoreWikipediaPages,
		ignoreIDs: plugin.settings.ignoreIDs,
		ignorePropertiesWithTimeRanges:
			plugin.settings.ignorePropertiesWithTimeRanges,
		internalLinkPrefix: plugin.settings.internalLinkPrefix,
	});

	for (const [key, value] of Object.entries(properties)) {
		frontmatter[key] = value.length === 1 ? value[0] : value;
	}

	await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
		for (const [key, value] of Object.entries(properties)) {
			if (plugin.settings.overwriteExistingProperties) {
				frontmatter[key] = value.length === 1 ? value[0] : value;
			} else if (!frontmatter[key]) {
				frontmatter[key] = value.length === 1 ? value[0] : value;
			}
		}

		// Ensure the entity ID is always set, which may not be the case if this is
		// the first time the entity is being imported.
		frontmatter[plugin.settings.entityIdKey] = entity.id;
	});
}

class WikidataEntitySuggestModal extends SuggestModal<Entity> {
	plugin: WikidataImporterPlugin;

	constructor(plugin: WikidataImporterPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.setPlaceholder("Search for a Wikidata entity");
	}

	getSuggestions(query: string): Promise<Entity[]> {
		return Entity.search(query);
	}

	async onChooseSuggestion(item: Entity, evt: MouseEvent | KeyboardEvent) {
		let loading = new Notice(`wtf? bbq? Importing entity ${item.id}...`);

		try {
			if (this.plugin.settings.internalLinkPrefix === "db/") {
				this.plugin.settings.internalLinkPrefix = `db/{label}`;
			}

			let name = Entity.buildLink(
				this.plugin.settings.internalLinkPrefix + `.md`,
				item.label!,
				item.id.substring(1)
			);
			console.log(name);
			let file = this.app.vault.getAbstractFileByPath(name);
			if (!(file instanceof TFile)) {
				file = await this.app.vault.create(name, "");
			}
			await syncEntityToFile(this.plugin, item, file as TFile);
			let leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) {
				leaf.openFile(file as TFile);
			}
		} catch (e) {
			new Notice(`Error importing entity ${item.id}: ${e}`);
			return;
		} finally {
			loading.hide();
		}
	}

	renderSuggestion(entity: Entity, el: HTMLElement): void {
		el.createEl("div", { text: entity.label });
		el.createEl("small", { text: entity.description });
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
		try {
			await syncEntityToFile(this, entity, file);
		} catch (e) {
			new Notice(
				`Error importing properties for entity ${entity.id}: ${e}`
			);
			return;
		} finally {
			loading.hide();
		}
	}

	async onload() {
		await this.loadSettings();

		console.log("WikidataImporterPlugin loaded");

		this.addCommand({
			id: "import-properties-for-active-file",
			name: "Import properties for active file",
			editorCallback: this.importProperties.bind(this),
		});

		this.addCommand({
			id: "import-entity",
			name: "Import entity",
			callback: () => {
				new WikidataEntitySuggestModal(this).open();
			},
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
			.setName('Ignore "Wikipedia:" pages')
			.setDesc(
				'If checked, pages starting with "Wikipedia:" (e.g. lists) will not be imported'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ignoreWikipediaPages)
					.onChange(async (value) => {
						this.plugin.settings.ignoreWikipediaPages = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ignore ID properties")
			.setDesc(
				"If checked, the plethora of ID properties will not be imported"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ignoreIDs)
					.onChange(async (value) => {
						this.plugin.settings.ignoreIDs = value;
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

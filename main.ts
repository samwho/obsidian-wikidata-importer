import {
	App,
	MarkdownView,
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
	spaceReplacement: string;
	ignoreCategories: boolean;
	ignoreWikipediaPages: boolean;
	ignoreIDs: boolean;
	ignorePropertiesWithTimeRanges: boolean;
	overwriteExistingProperties: boolean;
	allowedProperties: string[];
	blockedProperties: string[];
	language: string;
}

const DEFAULT_SETTINGS: WikidataImporterSettings = {
	entityIdKey: "wikidata entity id",
	internalLinkPrefix: "db/${label}",
	spaceReplacement: "",
	ignoreCategories: true,
	ignoreWikipediaPages: true,
	ignoreIDs: true,
	ignorePropertiesWithTimeRanges: true,
	overwriteExistingProperties: false,
	blockedProperties: [],
	allowedProperties: [],
	language: "en",
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
		language: plugin.settings.language,
		ignoreCategories: plugin.settings.ignoreCategories,
		ignoreWikipediaPages: plugin.settings.ignoreWikipediaPages,
		ignoreIDs: plugin.settings.ignoreIDs,
		ignorePropertiesWithTimeRanges:
			plugin.settings.ignorePropertiesWithTimeRanges,
		internalLinkPrefix: plugin.settings.internalLinkPrefix,
		spaceReplacement: plugin.settings.spaceReplacement,
	});

	const filteredProperties: string[] = [];

	for (const [key, value] of Object.entries(properties)) {
		if (
			// If the "allowed properties" is defined, only import properties that are defined in the setting
			// If the "blocked properties" is defined, do not import properties that are defined in the setting
			(plugin.settings.allowedProperties?.length &&
				!plugin.settings.allowedProperties.includes(key)) ||
			(plugin.settings.blockedProperties?.length &&
				plugin.settings.blockedProperties.includes(key))
		) {
			console.log(`Wikidata: skipping property ${key}`);
			continue;
		} else {
			filteredProperties.push(key);
		}
		frontmatter[key] = value.length === 1 ? value[0] : value;
	}

	await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
		for (const [key, value] of Object.entries(properties)) {
			if (filteredProperties.includes(key)) {
				if (plugin.settings.overwriteExistingProperties) {
					frontmatter[key] = value.length === 1 ? value[0] : value;
				} else if (!frontmatter[key]) {
					frontmatter[key] = value.length === 1 ? value[0] : value;
				}
			}
		}

		// Ensure the entity ID is always set, which may not be the case if this is
		// the first time the entity is being imported.
		frontmatter[plugin.settings.entityIdKey] = entity.id;
	});
}

class WikidataEntitySuggestModal extends SuggestModal<Entity> {
	plugin: WikidataImporterPlugin;
	activeFile?: TFile;

	constructor(plugin: WikidataImporterPlugin, activeFile?: TFile) {
		super(plugin.app);
		this.plugin = plugin;
		this.activeFile = activeFile;
		this.setPlaceholder("Search for a Wikidata entity");
	}

	getSuggestions(query: string): Promise<Entity[]> {
		return Entity.search(query, {
			language: this.plugin.settings.language,
		});
	}

	async onChooseSuggestion(item: Entity, _evt: MouseEvent | KeyboardEvent) {
		let loading = new Notice(`Importing entity ${item.id}...`);

		try {
			if (this.plugin.settings.internalLinkPrefix === "db/") {
				this.plugin.settings.internalLinkPrefix = "db/${label}";
			}

			let name = Entity.buildLink(
				this.plugin.settings.internalLinkPrefix + `.md`,
				item.label!,
				item.id.substring(1)
			);

			let file =
				this.activeFile || this.app.vault.getAbstractFileByPath(name);
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
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file");
			return;
		}

		let frontmatter =
			this.app.metadataCache.getFileCache(file)?.frontmatter || {};

		let entityId: string = frontmatter[this.settings.entityIdKey];
		if (entityId?.startsWith("https://www.wikidata.org/wiki/")) {
			entityId = entityId.substring(
				"https://www.wikidata.org/wiki/".length
			);
		}
		if (!entityId || !entityId.startsWith("Q")) {
			new Notice(
				`No Wikidata entity ID found in frontmatter key "${this.settings.entityIdKey}", searching for a Wikidata entity from the file name "${file.basename}"...`
			);
			const modal = new WikidataEntitySuggestModal(this, file);
			modal.open();
			modal.inputEl.value = file.basename;
			modal.inputEl.dispatchEvent(new Event("input"));
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

	async importEntityFromHighlightedText() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file");
			return;
		}

		let selection;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const view_mode = view.getMode();
			switch (view_mode) {
				case "preview":
					// The plugin does not support importing entities from the preview mode yet.
					break;
				case "source":
					if ("editor" in view) {
						selection = view.editor.getSelection();
					}
					break;
				default:
					break;
			}
		}
		if (!selection) {
			new Notice("No text selected");
			return;
		}
		const loading = new Notice("Loading entity from highlighted text...");
		try {
			// Search a Wikidata entity from the highlighted text, using the modal
			const modal = new WikidataEntitySuggestModal(this);
			modal.open();
			modal.inputEl.value = selection;
			modal.inputEl.dispatchEvent(new Event("input"));
		} catch (e) {
			new Notice(`Error importing entity from highlighted text: ${e}`);
			return;
		} finally {
			loading.hide();
		}
	}

	async onload() {
		await this.loadSettings();

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

		this.addCommand({
			id: "import-entity-from-highlighted-text",
			name: "Import entity from highlighted text",
			editorCallback: this.importEntityFromHighlightedText.bind(this),
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
			.setName("Language")
			.setDesc("The language to use for Wikidata entities")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.language)
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value;
						await this.plugin.saveSettings();
					})
			);

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
		.setName("Non-letter character replacement string (properties only)")
		.setDesc(
			"Clear this to keep all non-Letter characters in Wikidata property names and leave them unchanged"
		)
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SETTINGS.spaceReplacement)
				.setValue(this.plugin.settings.spaceReplacement)
				.onChange(async (value) => {
					this.plugin.settings.spaceReplacement = value;
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

		new Setting(containerEl)
			.setName("Blocked properties")
			.setDesc(
				"Do not import properties with these labels, one per line, even if they are allowed by the 'allowed properties' setting"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("label1\nlabel2\n...")
					.setValue(
						this.plugin.settings.blockedProperties?.join("\n")
					)
					.onChange(async (value) => {
						this.plugin.settings.blockedProperties = value
							.trim()
							.split("\n")
							.filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Allowed properties")
			.setDesc(
				"Only import properties with these labels, one per line, making the 'blocked properties' irrelevant"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("label1\nlabel2\n...")
					.setValue(
						this.plugin.settings.allowedProperties?.join("\n")
					)
					.onChange(async (value) => {
						this.plugin.settings.allowedProperties = value
							.trim()
							.split("\n")
							.filter(Boolean);
						await this.plugin.saveSettings();
					})
			);
	}
}

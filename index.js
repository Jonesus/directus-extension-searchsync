const { flattenObject, objectMap } = require('./utils');
const he = require('he');

module.exports = function registerHook({ services, env, database, getSchema }) {
	const extensionConfig = require(env.EXTENSION_SEARCHSYNC_CONFIG ||
		"./config.json");

	if (!("collections" in extensionConfig)) {
		throw Error('Broken config file. Missing "collections" section.');
	}

	if (!("server" in extensionConfig)) {
		throw Error('Broken config file. Missing "server" section.');
	}

	const indexer = require(`./indexers/${extensionConfig.server.type}`)(
		extensionConfig.server,
		env
	);

	return {
		"server.start": initCollectionIndexes,
		"items.create": hookEventHandler.bind(null, updateItemIndex),
		"items.update": hookEventHandler.bind(null, updateItemIndex),
		"items.delete.before": hookEventHandler.bind(null, deleteItemIndex),
	};

	async function initCollectionIndexes() {
		for (const collection of Object.keys(extensionConfig.collections)) {
			if (extensionConfig.reindexOnStart) {
				const translations = extensionConfig.collections[collection].translations;
				if (translations) {
					for (const translationIndex of Object.values(translations)) {
						await reindexIndex(collection, translationIndex);
					}
				} else {
					await reindexIndex(collection);
				}
				await reindexCollection(collection);
			} else {
				try {
					await indexer.createIndex(collection);
				} catch (error) {
					errorLog("CREATE", collection, null, error);
					continue;
				}
			}
		}
	}

	async function reindexIndex(collection, index) {
		try {
			await indexer.dropIndex(index || collection);
		} catch (error) {
			errorLog("DROP", index, null, error);
		}

		try {
			await indexer.createIndex(index || collection);
		} catch (error) {
			errorLog("CREATE", index, null, error);
			return;
		}
	}

	async function reindexCollection(collection) {
		const schema = await getSchema();
		const query = new services.ItemsService(collection, { database, schema });
		const pk = schema['tables'][collection].primary;
		const items = await query.readByQuery({
			fields: [pk],
			filter: extensionConfig.collections[collection].filter || [],
		});
		for (const item of items) {
			await updateItemIndex(collection, item[pk], schema);
		}
	}

	async function deleteItemIndex(collection, id, schema) {
		try {
			const translations = extensionConfig.collections[collection].translations;
			if (translations) {
				const body = await getItemObject(collection, id, schema);
				for (const translationKey of Object.keys(translations)) {
					const translationData = body?.translations.find(t => t.languages_code === translationKey);
					if (body && translationData) {
						indexer.deleteItem(translations[translationKey], id);
					}
				}
			} else {
				indexer.deleteItem(collection, id);
			}
		} catch (error) {
			errorLog("delete", collection, id, error);
		}
	}

	async function updateItemIndex(collection, id, schema) {
		const body = await getItemObject(collection, id, schema);
		try {
			const translations = extensionConfig.collections[collection].translations;
			if (translations) {
				for (const translationKey of Object.keys(translations)) {
					let translationData = body?.translations.find(t => t.languages_code === translationKey);
					if (!translationData) {
						translationData = { ...body?.translations[0], languages_code: translationKey };
					}
					if (body && translationData) {
						const singleLanguageBody = transformData({ ...body, translations: translationData }, collection);
						indexer.updateItem(translations[translationKey], id, singleLanguageBody, schema['tables'][collection].primary);
					}
				}
			} else {
				if (body) {
					indexer.updateItem(collection, id, transformData(body, collection), schema['tables'][collection].primary);
				} else {
					indexer.deleteItem(collection, id);
				}
			}
		} catch (error) {
			console.log(error)
			errorLog("update", collection, id, error);
		}
	}

	async function getItemObject(collection, id, schema) {
		const query = new services.ItemsService(collection, {
			knex: database,
			schema: schema,
		});
		let data = await query.readByKey(id, {
			fields: extensionConfig.collections[collection].fields,
			filter: extensionConfig.collections[collection].filter || [],
		});

		return data;
	}

	function hookEventHandler(callback, input) {
		if (!(input.collection in extensionConfig.collections)) {
			return;
		}
		const items = Array.isArray(input.item) ? input.item : [input.item];
		for (const item of items) {
			callback(input.collection, item, input.schema);
		}
	}

	function errorLog(action, collection, id, error) {
		console.warn(
			"SEARCHSYNC",
			`Error when ${action} ${collection}/${id || ""}`,
			error ? "" : error.toString()
		);
	}

	function transformData(data, collection) {
		if (extensionConfig.collections[collection].flatten) {
			data = flattenObject(data);
		}
		if (extensionConfig.collections[collection].stripHtml) {
			data = objectMap(data,
				(value) => typeof value === 'string'
					? he.decode(value.replace(/(<([^>]+)>)/gi, " ")).replace(/\s+/g,' ').trim()
					: value
			);
		}
		return data;
	}
};

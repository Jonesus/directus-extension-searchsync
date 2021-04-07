const axios = require("axios");

module.exports = function meilisearch(config, env) {
	const axiosConfig = {
		headers: config.headers || {},
	};

	if (env.MEILI_MASTER_KEY){
		axiosConfig.headers["X-Meili-API-Key"] = env.MEILI_MASTER_KEY;
	} else if (config.key) {
		axiosConfig.headers["X-Meili-API-Key"] = config.key;
	}

	const host = env.MEILI_URL || config.host;

	return {
		createIndex,
		dropIndex,
		deleteItem,
		updateItem,
	};

	async function createIndex(collection) {}

	async function dropIndex(collection) {
		try {
			return await axios.delete(
				`${host}/indexes/${collection}`,
				axiosConfig
			);
		} catch (error) {
			if (error.response && error.response.status === 404) {
				return;
			}
			throw error;
		}
	}

	async function deleteItem(collection, id) {
		try {
			return await axios.delete(
				`${host}/indexes/${collection}/documents/${id}`,
				axiosConfig
			);
		} catch (error) {
			if (error.response && error.response.status === 404) {
				return;
			}
			throw error;
		}
	}

	async function updateItem(collection, id, data, pk) {
		return await axios.post(
			`${host}/indexes/${collection}/documents?primaryKey=${pk}`,
			[{ id, ...data }],
			axiosConfig
		);
	}
};

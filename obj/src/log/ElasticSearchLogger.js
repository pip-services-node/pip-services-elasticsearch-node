"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let async = require('async');
const pip_services_commons_node_1 = require("pip-services-commons-node");
const pip_services_rpc_node_1 = require("pip-services-rpc-node");
const pip_services_commons_node_2 = require("pip-services-commons-node");
const pip_services_components_node_1 = require("pip-services-components-node");
class ElasticSearchLogger extends pip_services_components_node_1.CachedLogger {
    constructor() {
        super();
        this._connectionResolver = new pip_services_rpc_node_1.HttpConnectionResolver();
        this._index = "log";
        this._dailyIndex = false;
        this._reconnect = 60000;
        this._timeout = 30000;
        this._maxRetries = 3;
        this._indexMessage = false;
        this._client = null;
    }
    configure(config) {
        super.configure(config);
        this._connectionResolver.configure(config);
        this._index = config.getAsStringWithDefault('index', this._index);
        this._dailyIndex = config.getAsBooleanWithDefault('daily', this._dailyIndex);
        this._reconnect = config.getAsIntegerWithDefault('options.reconnect', this._reconnect);
        this._timeout = config.getAsIntegerWithDefault('options.timeout', this._timeout);
        this._maxRetries = config.getAsIntegerWithDefault('options.max_retries', this._maxRetries);
        this._indexMessage = config.getAsBooleanWithDefault('options.index_message', this._indexMessage);
    }
    setReferences(references) {
        super.setReferences(references);
        this._connectionResolver.setReferences(references);
    }
    isOpened() {
        return this._timer != null;
    }
    open(correlationId, callback) {
        if (this.isOpened()) {
            callback(null);
            return;
        }
        this._connectionResolver.resolve(correlationId, (err, connection) => {
            if (connection == null)
                err = new pip_services_commons_node_2.ConfigException(correlationId, 'NO_CONNECTION', 'Connection is not configured');
            if (err != null) {
                callback(err);
                return;
            }
            let uri = connection.getUri();
            let options = {
                host: uri,
                requestTimeout: this._timeout,
                deadTimeout: this._reconnect,
                maxRetries: this._maxRetries
            };
            let elasticsearch = require('elasticsearch');
            this._client = new elasticsearch.Client(options);
            this.createIndexIfNeeded(correlationId, true, (err) => {
                if (err == null) {
                    this._timer = setInterval(() => { this.dump(); }, this._interval);
                }
                callback(err);
            });
        });
    }
    close(correlationId, callback) {
        this.save(this._cache, (err) => {
            if (this._timer)
                clearInterval(this._timer);
            this._cache = [];
            this._timer = null;
            this._client = null;
            if (callback)
                callback(null);
        });
    }
    getCurrentIndex() {
        if (!this._dailyIndex)
            return this._index;
        let now = new Date();
        let year = now.getUTCFullYear().toString();
        let month = (now.getUTCMonth() + 1).toString();
        month = month.length < 2 ? "0" + month : month;
        let day = now.getUTCDate().toString();
        day = day.length < 2 ? "0" + day : day;
        return this._index + "-" + year + month + day;
    }
    createIndexIfNeeded(correlationId, force, callback) {
        let newIndex = this.getCurrentIndex();
        if (!force && this._currentIndex == newIndex) {
            callback(null);
            return;
        }
        this._currentIndex = newIndex;
        this._client.indices.exists({ index: this._currentIndex }, (err, exists) => {
            if (err || exists) {
                callback(err);
                return;
            }
            this._client.indices.create({
                index: this._currentIndex,
                body: {
                    settings: {
                        number_of_shards: 1
                    },
                    mappings: {
                        log_message: {
                            properties: {
                                time: { type: "date", index: true },
                                source: { type: "keyword", index: true },
                                level: { type: "keyword", index: true },
                                correlation_id: { type: "text", index: true },
                                error: {
                                    type: "object",
                                    properties: {
                                        type: { type: "keyword", index: true },
                                        category: { type: "keyword", index: true },
                                        status: { type: "integer", index: false },
                                        code: { type: "keyword", index: true },
                                        message: { type: "text", index: false },
                                        details: { type: "object" },
                                        correlation_id: { type: "text", index: false },
                                        cause: { type: "text", index: false },
                                        stack_trace: { type: "text", index: false }
                                    }
                                },
                                message: { type: "text", index: this._indexMessage }
                            }
                        }
                    }
                }
            }, (err) => {
                // Skip already exist errors
                if (err && err.message.indexOf('resource_already_exists') >= 0)
                    err = null;
                callback(err);
            });
        });
    }
    save(messages, callback) {
        if (!this.isOpened() && messages.length == 0) {
            if (callback)
                callback(null);
            return;
        }
        this.createIndexIfNeeded('elasticsearch_logger', false, (err) => {
            if (err) {
                if (callback)
                    callback(err);
                return;
            }
            let bulk = [];
            for (let message of messages) {
                bulk.push({ index: { _index: this._currentIndex, _type: "log_message", _id: pip_services_commons_node_1.IdGenerator.nextLong() } });
                bulk.push(message);
            }
            this._client.bulk({ body: bulk }, callback);
        });
    }
}
exports.ElasticSearchLogger = ElasticSearchLogger;
//# sourceMappingURL=ElasticSearchLogger.js.map
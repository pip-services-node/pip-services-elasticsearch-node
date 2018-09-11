/** @module log */
/** @hidden */
let async = require('async');

import { ConfigParams } from 'pip-services-commons-node';
import { IReferences } from 'pip-services-commons-node';
import { IReferenceable } from 'pip-services-commons-node';
import { IOpenable } from 'pip-services-commons-node';
import { IdGenerator } from 'pip-services-commons-node';
import { HttpConnectionResolver } from 'pip-services-rpc-node';
import { ConfigException } from 'pip-services-commons-node';
import { CachedLogger } from 'pip-services-components-node';
import { LogMessage } from 'pip-services-components-node';

/**
 * Microservice that allows usage of ElasticSearch for finding items in a log.
 * 
 * ### Configuration parameters ###
 * 
 * Parameters to pass to the [[configure]] method for component configuration:
 * 
 * - "level" - the LogLevel to set (default is LogLevel.Info);
 * - "source" - the logger's source;
 * - __options__
 *     - "options.interval" - the interval after which the cache should be dumped;
 *     - "options.max_cache_size" - set a maximum limit for the cache's size.
 * 
 * ### References ###
 * 
 * A context and a discovery service can be referenced by passing the 
 * following references to the object's [[setReferences]] method:
 * 
 * - context-info: <code>"\*:context-info:\*:\*:1.0"</code>;
 * - connection resolver's discovery service: <code>"\*:discovery:\*:\*:1.0"</code>.
 */
export class ElasticSearchLogger extends CachedLogger implements IReferenceable, IOpenable {
    private _connectionResolver: HttpConnectionResolver = new HttpConnectionResolver();
    
    private _timer: any;
    private _index: string = "log";
    private _dailyIndex: boolean = false;
    private _currentIndex: string;
    private _reconnect: number = 60000;
    private _timeout: number = 30000;
    private _maxRetries: number = 3;    
    private _indexMessage: boolean = false;

    private _client: any = null;

    /**
     * Creates a new ElasticSearchLogger object.
     */
    public constructor() {
        super();
    }

    /**
     * Configures this logger using the given configuration parameters.
     * 
     * __Configuration parameters:__
     * - "level" - the LogLevel to set (default is LogLevel.Info);
     * - "source" - the logger's source;
     * - __options__
     *     - "options.interval" - the interval after which the cache should be dumped;
     *     - "options.max_cache_size" - set a maximum limit for the cache's size.
     * 
     * @param config    the configuration parameters to configure this logger with.
     * 
     * @see [[https://rawgit.com/pip-services-node/pip-services-commons-node/master/doc/api/classes/config.configparams.html ConfigParams]] (in the PipServices "Commons" package)
     */
    public configure(config: ConfigParams): void {
        super.configure(config);

        this._connectionResolver.configure(config);

        this._index = config.getAsStringWithDefault('index', this._index);
        this._dailyIndex = config.getAsBooleanWithDefault('daily', this._dailyIndex);
        this._reconnect = config.getAsIntegerWithDefault('options.reconnect', this._reconnect);
        this._timeout = config.getAsIntegerWithDefault('options.timeout', this._timeout);
        this._maxRetries = config.getAsIntegerWithDefault('options.max_retries', this._maxRetries);
        this._indexMessage = config.getAsBooleanWithDefault('options.index_message', this._indexMessage);
    }

    /**
     * Sets this logger's source and connection resolver by setting references to a 
     * context and a discovery service.
     * 
     * __References:__
     * - context-info: <code>"\*:context-info:\*:\*:1.0"</code>;
     * - connection resolver's discovery service: <code>"\*:discovery:\*:\*:1.0"</code>.
     * 
     * @param references    an IReferences object, containing references to a context-info 
     *                      and a discovery service.
     * 
     * @see [[https://rawgit.com/pip-services-node/pip-services-commons-node/master/doc/api/interfaces/refer.ireferences.html IReferences]] (in the PipServices "Commons" package)
     */
    public setReferences(references: IReferences): void {
        super.setReferences(references);
        this._connectionResolver.setReferences(references);
    }

    /**
     * @returns     whether or not this logger is currently open.
     */
    public isOpen(): boolean {
        return this._timer != null;
    }

    /**
     * Opens this ElasticSearchLogger by creating a new ElasticSearch client and starting a 
     * "dump" timer, if a dump interval was set during configuration.
     *      
     * @param correlationId     unique business transaction id to trace calls across components.
     * @param callback          the function to call once the logger has been opened.
     *                          Will be called with an error, if one is raised.
     */
    public open(correlationId: string, callback: (err: any) => void): void {
        if (this.isOpen()) {
            callback(null);
            return;
        }

        this._connectionResolver.resolve(correlationId, (err, connection) => {
            if (connection == null)
                err = new ConfigException(correlationId, 'NO_CONNECTION', 'Connection is not configured');

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
                    this._timer = setInterval(() => { this.dump() }, this._interval);
                }

                callback(err);
            });
        });
    }

    /**
     * Closes this ElasticSearchLogger by saving and resetting its cache and freeing its 
     * timer and client.
     * 
     * @param correlationId     unique business transaction id to trace calls across components.
     * @param callback          the function to call once the logger has been closed.
     *                          Will be called with an error, if one is raised.
     * 
     * @see [[save]]
     */
    public close(correlationId: string, callback: (err: any) => void): void {
        this.save(this._cache, (err) => {
            if (this._timer)
                clearInterval(this._timer);

            this._cache = [];
            this._timer = null;
            this._client = null;

            if (callback) callback(null);
        });
    }

    private getCurrentIndex(): string {
        if (!this._dailyIndex) return this._index;

        let now = new Date();
        let year = now.getUTCFullYear().toString();
        let month = (now.getUTCMonth() + 1).toString();
        month = month.length < 2 ? "0" + month : month;
        let day = now.getUTCDate().toString();
        day = day.length < 2 ? "0" + day : day;
        return this._index + "-" + year + month + day;
    }

    private createIndexIfNeeded(correlationId: string, force: boolean, callback: (err: any) => void): void {
        let newIndex = this.getCurrentIndex();
        if (!force && this._currentIndex == newIndex) {
            callback(null);
            return;
        }

        this._currentIndex = newIndex;
        this._client.indices.exists(
            { index: this._currentIndex },
            (err, exists) => {
                if (err || exists) {
                    callback(err);
                    return;
                }

                this._client.indices.create(
                    {
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
                    },
                    (err) => {
                        // Skip already exist errors
                        if (err && err.message.indexOf('resource_already_exists') >= 0)
                            err = null;

                        callback(err);
                    }
                );
            }
        );
    }

    /**
     * Used to save this ElasticSearchLogger's cached messages. Saves them using
     * the ElasticSearch's <code>bulk</code> API (type is set to <code>"log_message"</code>).
     * 
     * @param messages  the messages to save.
     * @param callback  the function to call once the saving process has been 
     *                  completed. Will be called with an error, if one is raised.
     * 
     * @see ElasticSearch's [[https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html bulk API]]
     */
    protected save(messages: LogMessage[], callback: (err: any) => void): void {
        if (!this.isOpen()  && messages.length == 0) {
            if (callback) callback(null);
            return;
        }

        this.createIndexIfNeeded('elasticsearch_logger', false, (err) => {
            if (err) {
                if (callback) callback(err);
                return;
            }

            let bulk = [];
            for (let message of messages) {
                bulk.push({ index: { _index: this._currentIndex, _type: "log_message", _id: IdGenerator.nextLong() } })
                bulk.push(message);
            }

            this._client.bulk({ body: bulk }, callback);
        });
    }
}
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
 * Logger that dumps execution logs to ElasticSearch service.
 * 
 * ElasticSearch is a popular search index. It is often used 
 * to store and index execution logs by itself or as a part of
 * ELK (ElasticSearch - Logstash - Kibana) stack.
 * 
 * Authentication is not supported in this version.
 * 
 * ### Configuration parameters ###
 * 
 * - level:             maximum log level to capture
 * - source:            source (context) name
 * - connection(s):           
 *     - discovery_key:         (optional) a key to retrieve the connection from [[https://rawgit.com/pip-services-node/pip-services-components-node/master/doc/api/interfaces/connect.idiscovery.html IDiscovery]]
 *     - protocol:              connection protocol: http or https
 *     - host:                  host name or IP address
 *     - port:                  port number
 *     - uri:                   resource URI or connection string with all parameters in it
 * - options:
 *     - interval:        interval in milliseconds to save log messages (default: 10 seconds)
 *     - max_cache_size:  maximum number of messages stored in this cache (default: 100)        
 *     - index:           ElasticSearch index name (default: "log")
 *     - daily:           true to create a new index every day by adding date suffix to the index 
 *                        name (default: false)
 *     - reconnect:       reconnect timeout in milliseconds (default: 60 sec)
 *     - timeout:         invocation timeout in milliseconds (default: 30 sec)
 *     - max_retries:     maximum number of retries (default: 3)
 *     - index_message:   true to enable indexing for message object (default: false)
 * 
 * ### References ###
 * 
 * - <code>\*:context-info:\*:\*:1.0</code>      (optional) [[https://rawgit.com/pip-services-node/pip-services-components-node/master/doc/api/classes/info.contextinfo.html ContextInfo]] to detect the context id and specify counters source
 * - <code>\*:discovery:\*:\*:1.0</code>         (optional) [[https://rawgit.com/pip-services-node/pip-services-components-node/master/doc/api/interfaces/connect.idiscovery.html IDiscovery]] services to resolve connection
 * 
 * ### Example ###
 * 
 *     let logger = new ElasticSearchLogger();
 *     logger.configure(ConfigParams.fromTuples(
 *         "connection.protocol", "http",
 *         "connection.host", "localhost",
 *         "connection.port", 9200
 *     ));
 *     
 *     logger.open("123", (err) => {
 *         ...
 *     });
 *     
 *     logger.error("123", ex, "Error occured: %s", ex.message);
 *     logger.debug("123", "Everything is OK.");
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
     * Creates a new instance of the logger.
     */
    public constructor() {
        super();
    }

    /**
     * Configures component by passing configuration parameters.
     * 
     * @param config    configuration parameters to be set.
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
	 * Sets references to dependent components.
	 * 
	 * @param references 	references to locate the component dependencies. 
     */
    public setReferences(references: IReferences): void {
        super.setReferences(references);
        this._connectionResolver.setReferences(references);
    }

    /**
	 * Checks if the component is opened.
	 * 
	 * @returns true if the component has been opened and false otherwise.
     */
    public isOpen(): boolean {
        return this._timer != null;
    }

    /**
	 * Opens the component.
	 * 
	 * @param correlationId 	(optional) transaction id to trace execution through call chain.
     * @param callback 			callback function that receives error or null no errors occured.
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
	 * Closes component and frees used resources.
	 * 
	 * @param correlationId 	(optional) transaction id to trace execution through call chain.
     * @param callback 			callback function that receives error or null no errors occured.
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
     * Saves log messages from the cache.
     * 
     * @param messages  a list with log messages
     * @param callback  callback function that receives error or null for success.
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
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

    public constructor() {
        super();
    }

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

    public setReferences(references: IReferences): void {
        super.setReferences(references);
        this._connectionResolver.setReferences(references);
    }

    public isOpen(): boolean {
        return this._timer != null;
    }

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
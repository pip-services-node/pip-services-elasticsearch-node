"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** @module build */
const pip_services_components_node_1 = require("pip-services-components-node");
const pip_services_commons_node_1 = require("pip-services-commons-node");
const ElasticSearchLogger_1 = require("../log/ElasticSearchLogger");
/**
 * Creates ElasticSearch components by their descriptors.
 *
 * @see [[ElasticSearchLogger]]
 */
class DefaultElasticSearchFactory extends pip_services_components_node_1.Factory {
    /**
     * Create a new instance of the factory.
     */
    constructor() {
        super();
        this.registerAsType(DefaultElasticSearchFactory.ElasticSearchLoggerDescriptor, ElasticSearchLogger_1.ElasticSearchLogger);
    }
}
DefaultElasticSearchFactory.Descriptor = new pip_services_commons_node_1.Descriptor("pip-services", "factory", "elasticsearch", "default", "1.0");
DefaultElasticSearchFactory.ElasticSearchLoggerDescriptor = new pip_services_commons_node_1.Descriptor("pip-services", "logger", "elasticsearch", "*", "1.0");
exports.DefaultElasticSearchFactory = DefaultElasticSearchFactory;
//# sourceMappingURL=DefaultElasticSearchFactory.js.map
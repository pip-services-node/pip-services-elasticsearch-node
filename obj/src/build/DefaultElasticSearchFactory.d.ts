/** @module build */
import { Factory } from 'pip-services-components-node';
import { Descriptor } from 'pip-services-commons-node';
/**
 * Creates ElasticSearch components by their descriptors.
 *
 * @see [[ElasticSearchLogger]]
 */
export declare class DefaultElasticSearchFactory extends Factory {
    static readonly Descriptor: Descriptor;
    static readonly ElasticSearchLoggerDescriptor: Descriptor;
    /**
     * Create a new instance of the factory.
     */
    constructor();
}

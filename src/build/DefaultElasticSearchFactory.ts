/** @module build */
import { Factory } from 'pip-services-components-node';
import { Descriptor } from 'pip-services-commons-node';

import { ElasticSearchLogger } from '../log/ElasticSearchLogger';

/**
 * Creates ElasticSearch components by their descriptors.
 * 
 * @see [[ElasticSearchLogger]]
 */
export class DefaultElasticSearchFactory extends Factory {
	public static readonly Descriptor = new Descriptor("pip-services", "factory", "elasticsearch", "default", "1.0");
	public static readonly ElasticSearchLoggerDescriptor = new Descriptor("pip-services", "logger", "elasticsearch", "*", "1.0");

	/**
	 * Create a new instance of the factory.
	 */
	public constructor() {
        super();
		this.registerAsType(DefaultElasticSearchFactory.ElasticSearchLoggerDescriptor, ElasticSearchLogger);
	}
}
/*
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { BigQuery } = require("@google-cloud/bigquery");

import {
  SentimentAnalysisResult,
  NlpData,
  TextClassificationResult,
  EntityExtractionResult,
  Task,
} from "./models";
import {
  isSentimentAnalysisResult,
  isTextClassificationResult,
} from "./utilities";
import * as logs from "./logs";

export interface BigQueryHandlerConfig {
  datasetId: string;
  tablesPrefix: string;
  supportedTasks: Array<Task>;
}

export class BigQueryHandler {
  private readonly bigQuery = new BigQuery();
  private initialized: boolean = false;

  private readonly sentimentTableId: string;
  private readonly classificationTableId: string;
  private readonly entityTableId: string;

  private readonly sentimentTableSchema =
    "collection_path:string, doc_id:string, score:float, magnitude:float, timestamp:timestamp";

  private readonly classificationTableSchema =
    "collection_path:string, doc_id:string, class:string, timestamp:timestamp";

  private readonly entityTableSchema =
    "collection_path:string, doc_id:string, entity_name:string, entity_type:string, timestamp:timestamp";

  constructor(private readonly config: BigQueryHandlerConfig) {
    this.sentimentTableId = `${this.config.tablesPrefix}_${Task.SENTIMENT}`;
    this.classificationTableId = `${this.config.tablesPrefix}_${Task.CLASSIFICATION}`;
    this.entityTableId = `${this.config.tablesPrefix}_${Task.ENTITY}`;
  }

  async deleteNlpData(collectionPath: string, docID: string) {
    try {
      await this.initialize();
    } catch (err) {
      logs.bigQueryHandlerInitError(err);
      throw err;
    }

    const deleteQueries = this.config.supportedTasks.map((task) => {
      switch (task) {
        case Task.SENTIMENT:
          return this.buildDeleteQuery(this.sentimentTableId, collectionPath, docID);
        case Task.CLASSIFICATION:
          return this.buildDeleteQuery(this.classificationTableId, collectionPath, docID);
        case Task.ENTITY:
          return this.buildDeleteQuery(this.entityTableId, collectionPath, docID);
        default:
          throw new Error(`Task '${task}' not a supported task.`);
      }
    });

    // arrow function needed to access outer scope 'this'
    const queryJobs: Array<Promise<void>> = deleteQueries.map((query) => {
      if (query) {
        return this.performQuery(query);
      } else {
        return Promise.resolve();
      }
    });

    await Promise.all(queryJobs);
    logs.completedDeleteDataInBigQuery();
  }

  private buildDeleteQuery(
    tableID: string,
    collectionPath: string,
    docID: string
  ): string {
    const query = `DELETE FROM \`${this.config.datasetId}.${tableID}\` 
            WHERE (collection_path='${collectionPath}' AND doc_id='${docID}')`;
    return query;
  }

  async writeNlpData(data: NlpData, collectionPath: string, docID: string) {
    try {
      await this.initialize();
    } catch (err) {
      logs.bigQueryHandlerInitError(err);
      throw err;
    }

    logs.writingDataToBigQuery();

    const sharedTimestamp = new Date().toISOString();

    const insertQueries: Array<string> = Object.values(data).map((result) => {
      if (isSentimentAnalysisResult(result)) {
        return this.buildSentimentInsertQuery(
          result,
          collectionPath,
          docID,
          sharedTimestamp
        );
      } else if (isTextClassificationResult(result)) {
        return this.buildClassificationInsertQuery(
          result,
          collectionPath,
          docID,
          sharedTimestamp
        );
      } else {
        return this.buildEntityInsertQuery(
          result,
          collectionPath,
          docID,
          sharedTimestamp
        );
      }
    });

    // arrow function needed to access outer scope 'this'
    const queryJobs: Array<Promise<void>> = insertQueries.map((query) => {
      if (query) {
        return this.performQuery(query);
      } else {
        return Promise.resolve();
      }
    });

    await Promise.all(queryJobs);
    logs.completedWritingDataToBigQuery();
  }

  private async performQuery(queryString: string) {
    try {
      await this.bigQuery.query({ query: queryString });
    } catch (err) {
      logs.bigQueryQueryError(queryString, err);
    }
  }

  private buildSentimentInsertQuery(
    data: SentimentAnalysisResult,
    collectionPath: string,
    docID: string,
    timestamp: string
  ): string {
    const query = `INSERT INTO \`${this.config.datasetId}.${this.sentimentTableId}\` 
        (collection_path, doc_id, score, magnitude, timestamp) 
      VALUES (
        '${collectionPath}', 
        '${docID}', 
        ${data.score}, 
        ${data.magnitude}, 
        '${timestamp}'
      )`;

    return query;
  }

  private buildClassificationInsertQuery(
    data: TextClassificationResult,
    collectionPath: string,
    docID: string,
    timestamp: string
  ): string {
    let rows = data.reduce((rowsString, className) => {
      rowsString += `(
        '${collectionPath}', 
        '${docID}', 
        '${className}', 
        '${timestamp}'
      ),`;
      return rowsString;
    }, "");
    rows = rows.slice(0, -1); // remove trailing comma

    const query = `INSERT INTO \`${this.config.datasetId}.${this.classificationTableId}\` 
        (collection_path, doc_id, class, timestamp) 
      VALUES ${rows}`;

    return query;
  }

  private buildEntityInsertQuery(
    data: EntityExtractionResult,
    collectionPath: string,
    docID: string,
    timestamp: string
  ): string {
    let rows = "";

    for (const [type, entities] of Object.entries(data)) {
      for (const entity of entities) {
        rows += `(
          '${collectionPath}', 
          '${docID}', 
          '${entity}', 
          '${type}', 
          '${timestamp}'
        ),`;
      }
    }
    rows = rows.slice(0, -1); // remove trailing comma

    const query = `INSERT INTO \`${this.config.datasetId}.${this.entityTableId}\` 
        (collection_path, doc_id, entity_name, entity_type, timestamp) 
      VALUES ${rows}`;

    return query;
  }

  private async initialize() {
    if (this.initialized) {
      return;
    }

    logs.initializeBigQueryHandler();

    try {
      await this.initDataset();

      await this.initTable(this.sentimentTableSchema, this.sentimentTableId);
      await this.initTable(
        this.classificationTableSchema,
        this.classificationTableId
      );
      await this.initTable(this.entityTableSchema, this.entityTableId);

      logs.finishBigQueryHandlerInit();
      this.initialized = true;
    } catch (err) {
      this.initialized = false;
      throw err; // let caller handle error
    }
  }

  private async initDataset() {
    const dataset = this.bigQuery.dataset(this.config.datasetId);
    const [datasetExists] = await dataset.exists();

    if (!datasetExists) {
      logs.createDataset(this.config.datasetId);
      await dataset.create();
    }
  }

  private async initTable(tableSchema: string, tableId: string) {
    const dataset = this.bigQuery.dataset(this.config.datasetId);

    const table = dataset.table(tableId);
    const [tableExists] = await table.exists();

    if (!tableExists) {
      const options = {
        schema: tableSchema,
      };
      logs.createTable(tableId);
      await table.create(options);
    }
  }
}

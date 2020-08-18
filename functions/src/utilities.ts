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

import {
  SentimentAnalysisResult,
  TextClassificationResult,
  NlpTaskOutput,
  Task,
} from "./models";

export enum ChangeType {
  CREATE,
  DELETE,
  UPDATE,
}

export function isSentimentAnalysisResult(
  result: NlpTaskOutput
): result is SentimentAnalysisResult {
  return (result as SentimentAnalysisResult).score != undefined;
}

export function isTextClassificationResult(
  result: NlpTaskOutput
): result is TextClassificationResult {
  return Array.isArray(result as TextClassificationResult);
}

export function splitLastPathSegment(path: string) {
  const lastSlashIndex = path.lastIndexOf("/");
  const startSegment = path.substring(0, lastSlashIndex);
  const lastSegment = path.substring(lastSlashIndex + 1);

  return { startSegment: startSegment, lastSegment: lastSegment };
}

function isTaskStringValue(
  taskString: string
): taskString is keyof typeof Task {
  return Object.keys(Task).includes(taskString);
}

export function convertTaskStringListToEnumList(stringTasks: string[]): Task[] {
  const tasks: Task[] = [];
  for (const taskString of stringTasks) {
    if (isTaskStringValue(taskString)) {
      tasks.push(Task[taskString]);
    }
  }
  return tasks;
}

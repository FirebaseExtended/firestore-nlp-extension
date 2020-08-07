/*
 * Copyright 2019 Google LLC
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

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

export enum ChangeType {
  CREATE,
  DELETE,
  UPDATE,
}

/**
 * Determines the type of change (CREATE, DELETE, UPDATE) that
 * corresponds to the change object given.
 * @param change
 */
export function getChangeType(
  change: functions.Change<admin.firestore.DocumentSnapshot>
): ChangeType {
  if (!change.after.exists) {
    return ChangeType.DELETE;
  } else if (!change.before.exists) {
    return ChangeType.CREATE;
  } else {
    return ChangeType.UPDATE;
  }
}

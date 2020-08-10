/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Creates a mock implementation of a documentSnapshot.
 * Needed to specify the 'exist' variable which we can't do
 * with firebase-functions-test snapshots.
 * @param documentSnapshot
 * @param exists
 */
export const createMockDocSnapshotImplementation = ({
  documentSnapshot,
  exists,
}) => {
  return jest.fn().mockImplementation(() => {
    return {
      exists: exists,
      get: documentSnapshot.get.bind(documentSnapshot),
      ref: { path: documentSnapshot.ref.path },
    };
  })();
};

/**
 * Provides a mock implementation to replace firestores 'runTransaction'.
 */
export const mockFirestoreTransaction = jest.fn().mockImplementation(() => {
  return (transactionHandler) => {
    transactionHandler({
      update(ref, field, data) {
        mockFirestoreUpdate(ref, field, data);
      },
    });
  };
});

/**
 * Provides mock implementation used by mockFirestoreTransaction. Can be used
 * to track interactions.
 */
export const mockFirestoreUpdate = jest.fn();

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

import { afterEach, expect, it } from "vitest";
import { queryClient } from "./query-client";

afterEach(() => queryClient.clear());

it("does not repeat a committed mutation when its response is lost", async () => {
  let writes = 0;
  const mutation = queryClient.getMutationCache().build(queryClient, {
    retryDelay: 0,
    mutationFn: async () => {
      writes++;
      throw new TypeError("Response connection lost after commit");
    },
  });
  await expect(mutation.execute(undefined)).rejects.toThrow("Response connection lost");
  expect(writes).toBe(1);
});

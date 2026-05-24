import type { ContactView } from "./contacts";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestQueryClient, makeWrapper } from "@/test/utils";
import {
  contactKeys,
  useContact,
  useContacts,
  useCreateContact,
  useDeleteContact,
  useGrantContact,
  useRevokeContact,
  useUpdateContact,
} from "./contacts";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function contact(overrides: Partial<ContactView> = {}): ContactView {
  return {
    id: "c1",
    ownerId: "u1",
    name: "Acme",
    contactPerson: "Jane",
    phone: "123",
    email: "jane@example.com",
    address: "Dock 1",
    taxId: "tax-1",
    note: "Preferred",
    status: "active",
    visibility: "private",
    confidential: false,
    tags: [{ id: "tag1", name: "supplier" }],
    canManage: true,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

function ok(data: unknown) {
  return async () => jsonResponse({ success: true, data });
}

function urlOf(i = 0): string {
  return String(fetchMock.mock.calls[i]![0]);
}

function initOf(i = 0): RequestInit | undefined {
  return fetchMock.mock.calls[i]![1];
}

function bodyOf(i = 0): unknown {
  return JSON.parse(String(initOf(i)?.body));
}

describe("contactKeys", () => {
  it("namespaces list and detail keys deterministically", () => {
    expect(contactKeys.list()).toEqual(["contacts", "list", "all"]);
    expect(contactKeys.list({ tag: "supplier" })).toEqual(["contacts", "list", "supplier"]);
    expect(contactKeys.detail("c1")).toEqual(["contacts", "detail", "c1"]);
  });
});

describe("useContacts", () => {
  it("requests the unfiltered contact list", async () => {
    fetchMock.mockImplementation(ok([contact()]));
    const { result } = renderHook(() => useContacts(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.name).toBe("Acme");
    expect(urlOf()).toBe("/api/contacts");
  });

  it("encodes the tag filter into the query string", async () => {
    fetchMock.mockImplementation(ok([]));
    const { result } = renderHook(() => useContacts({ tag: "ship supplier" }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(urlOf()).toBe("/api/contacts?tag=ship+supplier");
  });
});

describe("useContact", () => {
  it("stays disabled until an id is supplied", () => {
    const { result } = renderHook(() => useContact(undefined), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches one contact by encoded id", async () => {
    fetchMock.mockImplementation(ok(contact({ id: "c 1" })));
    const { result } = renderHook(() => useContact("c 1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(urlOf()).toBe("/api/contacts/c%201");
  });
});

describe("contact mutations", () => {
  it("creates a contact via POST with a JSON body and invalidates contact queries", async () => {
    fetchMock.mockImplementation(ok(contact({ name: "New" })));
    const queryClient = makeTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateContact(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync({ name: "New", tags: ["supplier"], visibility: "public", confidential: true });

    expect(urlOf()).toBe("/api/contacts");
    expect(initOf()?.method).toBe("POST");
    expect(bodyOf()).toEqual({ name: "New", tags: ["supplier"], visibility: "public", confidential: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.all });
  });

  it("patches a contact and invalidates list plus detail queries", async () => {
    fetchMock.mockImplementation(ok(contact({ name: "Renamed" })));
    const queryClient = makeTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateContact(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync({ id: "c 1", name: "Renamed", phone: null });

    expect(urlOf()).toBe("/api/contacts/c%201");
    expect(initOf()?.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ name: "Renamed", phone: null });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.detail("c 1") });
  });

  it("deletes a contact via DELETE and invalidates list plus detail queries", async () => {
    fetchMock.mockImplementation(ok({ id: "c1" }));
    const queryClient = makeTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteContact(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync("c1");

    expect(urlOf()).toBe("/api/contacts/c1");
    expect(initOf()?.method).toBe("DELETE");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.detail("c1") });
  });

  it("grants contact access with a user target body", async () => {
    fetchMock.mockImplementation(ok({ id: "c1", target: { type: "user", id: "u2" } }));
    const queryClient = makeTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useGrantContact(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync({ id: "c1", userId: "u2" });

    expect(urlOf()).toBe("/api/contacts/c1/grant");
    expect(initOf()?.method).toBe("POST");
    expect(bodyOf()).toEqual({ userId: "u2" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.detail("c1") });
  });

  it("revokes contact access with a group target body", async () => {
    fetchMock.mockImplementation(ok({ id: "c1", target: { type: "group", id: "g2" }, revoked: true }));
    const queryClient = makeTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRevokeContact(), { wrapper: makeWrapper(queryClient) });

    await result.current.mutateAsync({ id: "c1", groupId: "g2" });

    expect(urlOf()).toBe("/api/contacts/c1/revoke");
    expect(initOf()?.method).toBe("POST");
    expect(bodyOf()).toEqual({ groupId: "g2" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contactKeys.detail("c1") });
  });
});

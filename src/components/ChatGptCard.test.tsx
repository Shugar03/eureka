import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatGptCard } from "./ChatGptCard";
import { api } from "../api";

vi.mock("../api", () => ({
  api: {
    chatgptStatus: vi.fn(),
    chatgptConnect: vi.fn(),
    chatgptDisconnect: vi.fn(),
    chatgptModels: vi.fn(),
  },
}));

const connected = { provider_id: "openai", account_id: "acc-1", email: "ana@example.com", expires: 1_900_000_000_000 };

describe("ChatGptCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers to connect when no account is stored", async () => {
    vi.mocked(api.chatgptStatus).mockResolvedValue(null);
    const onChange = vi.fn();
    render(<ChatGptCard onChange={onChange} />);
    expect(await screen.findByRole("button", { name: "Conectar con ChatGPT" })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows the email, never a token, when an account is connected", async () => {
    vi.mocked(api.chatgptStatus).mockResolvedValue(connected);
    const onChange = vi.fn();
    render(<ChatGptCard onChange={onChange} />);
    expect(await screen.findByTestId("chatgpt-account")).toHaveTextContent("ana@example.com");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("keeps the account on screen when disconnecting fails, because the tokens are still stored", async () => {
    vi.mocked(api.chatgptStatus).mockResolvedValue(connected);
    vi.mocked(api.chatgptDisconnect).mockRejectedValue(new Error("disco lleno"));
    const onChange = vi.fn();
    render(<ChatGptCard onChange={onChange} />);
    await screen.findByTestId("chatgpt-account");
    await userEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo desconectar: disco lleno");
    expect(screen.getByTestId("chatgpt-account")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(false);
  });

  it("forgets the account once the disconnect succeeds", async () => {
    vi.mocked(api.chatgptStatus).mockResolvedValue(connected);
    vi.mocked(api.chatgptDisconnect).mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(<ChatGptCard onChange={onChange} />);
    await screen.findByTestId("chatgpt-account");
    await userEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(await screen.findByRole("button", { name: "Conectar con ChatGPT" })).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

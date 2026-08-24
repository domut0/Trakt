import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeScannerSheet } from "../BarcodeScannerSheet";

describe("BarcodeScannerSheet", () => {
  let mockStopTrack: ReturnType<typeof vi.fn>;
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStopTrack = vi.fn();
    mockGetUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: mockStopTrack }],
    });

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
      },
    });

    // Mock HTMLMediaElement.prototype.play
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <BarcodeScannerSheet open={false} onClose={vi.fn()} onDetected={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("requests camera access with environment facingMode when opened", async () => {
    render(<BarcodeScannerSheet open={true} onClose={vi.fn()} onDetected={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Scan barcode" })).toBeInTheDocument();
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
    });
  });

  it("displays permission denied error state distinctly when getUserMedia rejects with NotAllowedError", async () => {
    const error = new DOMException("Permission denied", "NotAllowedError");
    mockGetUserMedia.mockRejectedValueOnce(error);

    render(<BarcodeScannerSheet open={true} onClose={vi.fn()} onDetected={vi.fn()} />);

    expect(await screen.findByText("Camera permission denied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry camera permission" })).toBeInTheDocument();
  });

  it("displays no camera error state distinctly when getUserMedia rejects with NotFoundError", async () => {
    const error = new DOMException("No camera found", "NotFoundError");
    mockGetUserMedia.mockRejectedValueOnce(error);

    render(<BarcodeScannerSheet open={true} onClose={vi.fn()} onDetected={vi.fn()} />);

    expect(await screen.findByText("No camera detected")).toBeInTheDocument();
  });

  it("stops all camera media tracks on unmount", async () => {
    const { unmount } = render(
      <BarcodeScannerSheet open={true} onClose={vi.fn()} onDetected={vi.fn()} />,
    );

    // Wait for stream to attach
    await screen.findByLabelText("Camera feed for barcode scanning");

    unmount();

    expect(mockStopTrack).toHaveBeenCalled();
  });
});

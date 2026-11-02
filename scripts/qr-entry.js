import QRCode from "qrcode";
window.CashbookQR = {
  toDataURL: (value) =>
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 320,
      color: { dark: "#102f49", light: "#ffffff" },
    }),
};

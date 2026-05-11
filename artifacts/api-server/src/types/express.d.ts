// Augment Express Request to carry the raw body buffer for Paystack webhook HMAC verification.
declare namespace Express {
  interface Request {
    rawBody?: Buffer;
  }
}

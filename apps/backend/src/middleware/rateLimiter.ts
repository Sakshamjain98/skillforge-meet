import rateLimit from 'express-rate-limit';

/** General API rate limiter: 200 requests per minute per IP */
export const apiLimiter = rateLimit({
  windowMs:         60 * 1000,
  max:              200,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests, please try again later.' },
});

/** Strict limiter for auth endpoints: 10 attempts per 15 minutes per IP */
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many auth attempts, please try again later.' },
  skipSuccessfulRequests: true,
});

/** TURN credential endpoint: 60 per minute */
export const turnLimiter = rateLimit({
  windowMs:         60 * 1000,
  max:              60,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests.' },
});
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing (PRD §8.1 — argon2). argon2id with sane memory/time costs. Verification is
 * constant-time via the library; a malformed stored hash verifies to `false` rather than throwing.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}

import { hash, type Options, verify } from "@node-rs/argon2";

const options: Options = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  algorithm: 2,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export async function verifyPassword(data: {
  password: string;
  hash: string;
}): Promise<boolean> {
  return verify(data.hash, data.password, options);
}

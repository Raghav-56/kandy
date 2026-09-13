import test from "node:test"
import assert from "node:assert/strict"

import {
  MAX_ATTACHMENT_BYTES,
  classifyAttachment,
  refuseAttachment,
} from "../dist/attachments.js"

const bytes = (...n: number[]) => Uint8Array.from(n)
const pad = (head: number[], size = 64) =>
  Uint8Array.from([...head, ...new Array<number>(size).fill(7)])

test("a screenshot is recognised from its bytes, whatever it is called", () => {
  // PNG, JPEG, GIF, BMP, WEBP — the formats a clipboard actually produces.
  assert.equal(classifyAttachment(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image")
  assert.equal(classifyAttachment(pad([0xff, 0xd8, 0xff, 0xe0])), "image")
  assert.equal(classifyAttachment(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), "image")
  assert.equal(classifyAttachment(pad([0x42, 0x4d, 0x36, 0x00])), "image")
  assert.equal(
    classifyAttachment(
      Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, ...new Array(32).fill(0x20),
      ]),
    ),
    "image",
  )
})

test("text is text even when the browser calls it something else", () => {
  // Chrome reports .ts as video/mp2t, which is why this is decided from
  // content and not from the MIME type the file picker hands over.
  const ts = new TextEncoder().encode("export const x: number = 1\n")
  assert.equal(classifyAttachment(ts), "text")
  assert.equal(classifyAttachment(new TextEncoder().encode("héllo — em dash, é, 日本語")), "text")
})

test("a binary that is not an image is neither, and is refused with a reason", () => {
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0xff, 0xfe, 0x00, 0x01])
  assert.equal(classifyAttachment(zip), "binary")
  assert.match(
    refuseAttachment("archive.zip", zip) ?? "",
    /archive\.zip is neither an image nor text/,
  )
})

test("an image and a text file are accepted", () => {
  assert.equal(refuseAttachment("shot.png", pad([0x89, 0x50, 0x4e, 0x47])), null)
  assert.equal(refuseAttachment("log.txt", new TextEncoder().encode("boom")), null)
})

test("the size cap is stated in the refusal, not left to be guessed", () => {
  const huge = new Uint8Array(MAX_ATTACHMENT_BYTES + 1).fill(0x41)
  assert.match(refuseAttachment("huge.log", huge) ?? "", /the limit is 8MB/)
})

test("an empty file is refused rather than attached as nothing", () => {
  assert.match(refuseAttachment("empty.png", bytes()) ?? "", /empty/)
})

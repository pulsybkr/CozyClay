"""Read MPEG Layer III duration without a decoder or an external executable.

Count complete audio frames, including variable bitrates. Xing/VBRI frame counts
and the encoder's gapless delay/padding take precedence when present. This only
measures timing; it never decodes, modifies or synthesizes narration audio.
"""
import mmap


def _frame(header):
    if len(header) != 4:
        return None
    word = int.from_bytes(header, "big")
    version = (word >> 19) & 3
    layer = (word >> 17) & 3
    bitrate_index = (word >> 12) & 15
    rate_index = (word >> 10) & 3
    if word >> 21 != 0x7FF or version == 1 or layer != 1 or bitrate_index in (0, 15) or rate_index == 3:
        return None
    rates = (44100, 48000, 32000)
    rate = rates[rate_index] // (1 if version == 3 else 2 if version == 2 else 4)
    bitrates = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320) if version == 3 else (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
    size = (144000 if version == 3 else 72000) * bitrates[bitrate_index] // rate + ((word >> 9) & 1)
    return {"size": size, "rate": rate, "samples": 1152 if version == 3 else 576,
            "version": version, "mono": ((word >> 6) & 3) == 3, "crc": not ((word >> 16) & 1)}


def measure_mp3_duration(path):
    with open(path, "rb") as file:
        if not file.seek(0, 2):
            raise ValueError("Empty MP3 file")
        file.seek(0)
        with mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as data:
            offset = 0
            if data[:3] == b"ID3":
                if len(data) < 10 or any(byte & 0x80 for byte in data[6:10]):
                    raise ValueError("Invalid MP3 ID3 header")
                tag_size = sum(byte << shift for byte, shift in zip(data[6:10], (21, 14, 7, 0)))
                offset = 10 + tag_size + (10 if data[5] & 0x10 else 0)
            # Do not mistake arbitrary tag/payload bytes for a frame header.
            first = None
            for candidate in range(offset, min(offset + 65536, len(data) - 7)):
                header = _frame(data[candidate:candidate + 4])
                if not header:
                    continue
                next_at = candidate + header["size"]
                next_header = _frame(data[next_at:next_at + 4])
                if next_header and next_header["rate"] == header["rate"] and next_header["version"] == header["version"]:
                    offset, first = candidate, header
                    break
            if first is None:
                raise ValueError("No complete MPEG Layer III frames found")
            first_offset, frame_count = offset, 0
            while offset + 4 <= len(data):
                header = _frame(data[offset:offset + 4])
                if not header:
                    tail = data[offset:]
                    if tail.startswith((b"TAG", b"ID3", b"APETAGEX")) or not tail.strip(b"\0"):
                        break
                    raise ValueError("Invalid MP3 frame or trailing data")
                if header["rate"] != first["rate"] or header["version"] != first["version"] or offset + header["size"] > len(data):
                    raise ValueError("Truncated MP3 or changing sample clock")
                frame_count += 1
                offset += header["size"]
            side_info = (17 if first["mono"] else 32) if first["version"] == 3 else (9 if first["mono"] else 17)
            info_at = first_offset + 4 + (2 if first["crc"] else 0) + side_info
            encoded_frames, trim_samples = frame_count, 0
            if data[info_at:info_at + 4] in (b"Xing", b"Info"):
                flags = int.from_bytes(data[info_at + 4:info_at + 8], "big")
                cursor = info_at + 8
                if flags & 1:
                    encoded_frames = int.from_bytes(data[cursor:cursor + 4], "big")
                    cursor += 4
                cursor += (4 if flags & 2 else 0) + (100 if flags & 4 else 0) + (4 if flags & 8 else 0)
                if data[cursor:cursor + 4] in (b"LAME", b"Lavc", b"Lavf") and cursor + 24 <= first_offset + first["size"]:
                    delay, padding = int.from_bytes(data[cursor + 21:cursor + 24], "big") >> 12, int.from_bytes(data[cursor + 21:cursor + 24], "big") & 0xFFF
                    trim_samples = delay + padding
            elif data[first_offset + 36:first_offset + 40] == b"VBRI":
                encoded_frames = int.from_bytes(data[first_offset + 50:first_offset + 54], "big")
            if encoded_frames <= 0 or encoded_frames > frame_count or frame_count - encoded_frames > 1:
                raise ValueError("MP3 index does not match its complete frames")
            samples = encoded_frames * first["samples"] - trim_samples
            if samples <= 0:
                raise ValueError("Invalid gapless MP3 sample count")
            return samples / first["rate"]

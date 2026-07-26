use std::fmt;

pub const DEFAULT_MAX_HEADER_BYTES: usize = 8 * 1024;
pub const DEFAULT_MAX_MESSAGE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FramingError {
    HeaderTooLarge,
    MissingContentLength,
    DuplicateContentLength,
    InvalidContentLength,
    MessageTooLarge(usize),
}

impl fmt::Display for FramingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HeaderTooLarge => {
                write!(formatter, "protocol header exceeds the configured limit")
            }
            Self::MissingContentLength => {
                write!(formatter, "protocol header has no Content-Length")
            }
            Self::DuplicateContentLength => {
                write!(
                    formatter,
                    "protocol header contains multiple Content-Length fields"
                )
            }
            Self::InvalidContentLength => write!(formatter, "protocol Content-Length is invalid"),
            Self::MessageTooLarge(length) => {
                write!(
                    formatter,
                    "protocol message of {length} bytes exceeds the configured limit"
                )
            }
        }
    }
}

pub struct ContentLengthDecoder {
    buffer: Vec<u8>,
    max_header_bytes: usize,
    max_message_bytes: usize,
}

impl Default for ContentLengthDecoder {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_HEADER_BYTES, DEFAULT_MAX_MESSAGE_BYTES)
    }
}

impl ContentLengthDecoder {
    pub fn new(max_header_bytes: usize, max_message_bytes: usize) -> Self {
        Self {
            buffer: Vec::new(),
            max_header_bytes,
            max_message_bytes,
        }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
    }

    pub fn next_message(&mut self) -> Result<Option<Vec<u8>>, FramingError> {
        let Some(header_end) = find_bytes(&self.buffer, b"\r\n\r\n") else {
            if self.buffer.len() > self.max_header_bytes {
                return Err(FramingError::HeaderTooLarge);
            }
            return Ok(None);
        };
        if header_end > self.max_header_bytes {
            return Err(FramingError::HeaderTooLarge);
        }

        let header = &self.buffer[..header_end];
        let header = std::str::from_utf8(header).map_err(|_| FramingError::InvalidContentLength)?;
        let mut content_length = None;
        for line in header.split("\r\n") {
            let Some((name, value)) = line.split_once(':') else {
                continue;
            };
            if !name.trim().eq_ignore_ascii_case("content-length") {
                continue;
            }
            if content_length.is_some() {
                return Err(FramingError::DuplicateContentLength);
            }
            let parsed = value
                .trim()
                .parse::<usize>()
                .map_err(|_| FramingError::InvalidContentLength)?;
            content_length = Some(parsed);
        }

        let content_length = content_length.ok_or(FramingError::MissingContentLength)?;
        if content_length > self.max_message_bytes {
            return Err(FramingError::MessageTooLarge(content_length));
        }
        let body_start = header_end + 4;
        let message_end = body_start + content_length;
        if self.buffer.len() < message_end {
            return Ok(None);
        }

        let message = self.buffer[body_start..message_end].to_vec();
        self.buffer.drain(..message_end);
        Ok(Some(message))
    }
}

pub fn encode_message(body: &[u8]) -> Vec<u8> {
    let mut message = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    message.extend_from_slice(body);
    message
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::{encode_message, ContentLengthDecoder, FramingError};

    #[test]
    fn decodes_a_message_split_at_every_byte() {
        let body = r#"{"jsonrpc":"2.0","id":1,"result":{"value":"中文😀"}}"#.as_bytes();
        let encoded = encode_message(body);
        let mut decoder = ContentLengthDecoder::default();
        for byte in encoded {
            decoder.push(&[byte]);
        }
        assert_eq!(
            decoder.next_message().expect("valid frame"),
            Some(body.to_vec())
        );
        assert_eq!(decoder.next_message().expect("empty buffer"), None);
    }

    #[test]
    fn decodes_multiple_messages_from_one_read() {
        let first = br#"{"id":1}"#;
        let second = br#"{"id":2}"#;
        let mut bytes = encode_message(first);
        bytes.extend(encode_message(second));
        let mut decoder = ContentLengthDecoder::default();
        decoder.push(&bytes);
        assert_eq!(decoder.next_message().expect("first"), Some(first.to_vec()));
        assert_eq!(
            decoder.next_message().expect("second"),
            Some(second.to_vec())
        );
    }

    #[test]
    fn rejects_invalid_and_oversized_lengths() {
        let mut invalid = ContentLengthDecoder::default();
        invalid.push(b"Content-Length: nope\r\n\r\n");
        assert_eq!(
            invalid.next_message(),
            Err(FramingError::InvalidContentLength)
        );

        let mut oversized = ContentLengthDecoder::new(128, 4);
        oversized.push(b"Content-Length: 5\r\n\r\n12345");
        assert_eq!(
            oversized.next_message(),
            Err(FramingError::MessageTooLarge(5))
        );
    }
}

use std::{env, sync::Arc};

use async_trait::async_trait;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const EMBEDDING_DIM: usize = 1536;

#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    fn ensure_available(&self) -> Result<(), String> {
        Ok(())
    }

    async fn embed(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String>;
}

pub fn provider_from_env() -> Result<Arc<dyn EmbeddingProvider>, String> {
    let provider = env::var("EMBEDDING_PROVIDER")
        .unwrap_or_else(|_| "openai".to_string())
        .to_lowercase();

    match provider.as_str() {
        "openai" => Ok(Arc::new(OpenAiEmbeddingProvider::from_env())),
        "mock" => Ok(Arc::new(MockEmbeddingProvider)),
        other => Err(format!(
            "unsupported EMBEDDING_PROVIDER '{other}'; expected 'openai' or 'mock'"
        )),
    }
}

pub struct OpenAiEmbeddingProvider {
    client: reqwest::Client,
    api_key: Option<String>,
    model: String,
}

impl OpenAiEmbeddingProvider {
    fn from_env() -> Self {
        let api_key = env::var("OPENAI_API_KEY")
            .ok()
            .filter(|value| !value.is_empty());
        let model = env::var("EMBEDDING_MODEL")
            .ok()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "text-embedding-3-small".to_string());

        Self {
            client: reqwest::Client::new(),
            api_key,
            model,
        }
    }
}

#[derive(Serialize)]
struct OpenAiEmbeddingRequest<'a> {
    model: &'a str,
    input: &'a [String],
}

#[derive(Deserialize)]
struct OpenAiEmbeddingResponse {
    data: Vec<OpenAiEmbeddingDatum>,
}

#[derive(Deserialize)]
struct OpenAiEmbeddingDatum {
    index: usize,
    embedding: Vec<f32>,
}

#[async_trait]
impl EmbeddingProvider for OpenAiEmbeddingProvider {
    fn ensure_available(&self) -> Result<(), String> {
        if self.api_key.is_none() {
            return Err(
                "OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai indexing jobs"
                    .to_string(),
            );
        }
        Ok(())
    }

    async fn embed(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
        self.ensure_available()?;
        if inputs.is_empty() {
            return Ok(Vec::new());
        }

        let api_key = self
            .api_key
            .as_ref()
            .ok_or_else(|| "OPENAI_API_KEY is missing".to_string())?;

        let response = self
            .client
            .post("https://api.openai.com/v1/embeddings")
            .bearer_auth(api_key)
            .json(&OpenAiEmbeddingRequest {
                model: &self.model,
                input: inputs,
            })
            .send()
            .await
            .map_err(|error| format!("embedding request failed: {error}"))?;

        if response.status() != StatusCode::OK {
            let status = response.status();
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "<unavailable body>".to_string());
            return Err(format!(
                "embedding request failed with {status}: {error_body}"
            ));
        }

        let mut payload: OpenAiEmbeddingResponse = response
            .json()
            .await
            .map_err(|error| format!("failed to decode embedding response JSON: {error}"))?;

        payload.data.sort_by_key(|item| item.index);

        if payload.data.len() != inputs.len() {
            return Err(format!(
                "embedding response size mismatch: expected {}, got {}",
                inputs.len(),
                payload.data.len()
            ));
        }

        let mut vectors = Vec::with_capacity(payload.data.len());
        for item in payload.data {
            if item.embedding.len() != EMBEDDING_DIM {
                return Err(format!(
                    "embedding dimension mismatch: expected {EMBEDDING_DIM}, got {}",
                    item.embedding.len()
                ));
            }
            vectors.push(item.embedding);
        }

        Ok(vectors)
    }
}

pub struct MockEmbeddingProvider;

#[async_trait]
impl EmbeddingProvider for MockEmbeddingProvider {
    async fn embed(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let mut all_embeddings = Vec::with_capacity(inputs.len());

        for input in inputs {
            let digest = Sha256::digest(input.as_bytes());
            let mut vector = vec![0.0_f32; EMBEDDING_DIM];
            for (index, value) in vector.iter_mut().enumerate() {
                let byte = digest[index % digest.len()] as f32;
                *value = (byte / 255.0) - 0.5;
            }
            all_embeddings.push(vector);
        }

        Ok(all_embeddings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_provider_reports_missing_api_key() {
        let provider = OpenAiEmbeddingProvider {
            client: reqwest::Client::new(),
            api_key: None,
            model: "text-embedding-3-small".to_string(),
        };

        let error = provider
            .ensure_available()
            .expect_err("provider should fail without API key");
        assert!(error.contains("OPENAI_API_KEY is required"));
    }

    #[tokio::test]
    async fn mock_provider_returns_expected_dimensions() {
        let provider = MockEmbeddingProvider;
        let embeddings = provider
            .embed(&["alpha".to_string(), "beta".to_string()])
            .await
            .expect("mock embeddings should succeed");

        assert_eq!(embeddings.len(), 2);
        assert!(
            embeddings
                .iter()
                .all(|embedding| embedding.len() == EMBEDDING_DIM)
        );
    }

    #[tokio::test]
    async fn mock_provider_is_deterministic_for_same_input() {
        let provider = MockEmbeddingProvider;
        let input = vec!["repeatable input".to_string()];

        let first = provider.embed(&input).await.expect("first embedding run");
        let second = provider.embed(&input).await.expect("second embedding run");

        assert_eq!(first, second);
    }
}

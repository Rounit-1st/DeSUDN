import { Router, Response } from 'express';
import { IDatabase } from '../db/interface.js';
import { AuthService } from '../auth/auth-service.js';
import { createAuthMiddleware, AuthenticatedRequest } from '../auth/auth-middleware.js';
import { ManifestValidator } from '@desudn/manifest';
import { UpdateManifest } from '@desudn/shared';

export function createSoftwareRouter(db: IDatabase, authService: AuthService): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(authService);

  // Authentication endpoints
  router.post('/auth/register', async (req, res) => {
    try {
      const { id, username, password, public_key } = req.body;
      if (!id || !username || !password || !public_key) {
        res.status(400).json({ error: 'Missing required registration fields' });
        return;
      }
      const result = await authService.registerPublisher(id, username, password, public_key);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password are required' });
        return;
      }
      const result = await authService.login(username, password);
      res.json(result);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  });

  // POST /api/software - Register new software
  router.post('/software', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id, name, description } = req.body;
      const publisherId = req.publisher!.id;

      if (!id || !name) {
        res.status(400).json({ error: 'Software id and name are required' });
        return;
      }

      // Check duplicate
      const existing = await db.query('SELECT id FROM software WHERE id = $1', [id]);
      if (existing.length > 0) {
        res.status(409).json({ error: `Software "${id}" already exists` });
        return;
      }

      await db.query(
        'INSERT INTO software (id, name, description, publisher_id) VALUES ($1, $2, $3, $4)',
        [id, name, description || '', publisherId]
      );

      res.status(201).json({
        id,
        name,
        description,
        publisher_id: publisherId,
        message: 'Software registered successfully',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/software/:softwareId/versions - Publish a version with signed manifest
  router.post(
    '/software/:softwareId/versions',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { softwareId } = req.params;
        const publisherId = req.publisher!.id;
        const { manifest, is_latest } = req.body as { manifest: UpdateManifest; is_latest?: boolean };

        if (!manifest) {
          res.status(400).json({ error: 'Update manifest is required' });
          return;
        }

        // Verify software ownership
        const softwareRows = await db.query('SELECT publisher_id FROM software WHERE id = $1', [
          softwareId,
        ]);
        if (softwareRows.length === 0) {
          res.status(404).json({ error: `Software "${softwareId}" not found` });
          return;
        }

        if (softwareRows[0].publisher_id !== publisherId) {
          res.status(403).json({ error: 'Unauthorized: You are not the publisher of this software' });
          return;
        }

        // Validate manifest & signature
        ManifestValidator.assertValid(manifest, req.publisher!.publicKey);

        // If is_latest is true or undefined, update previous latest flags
        const setLatest = is_latest !== false;
        if (setLatest) {
          await db.query('UPDATE software_versions SET is_latest = FALSE WHERE software_id = $1', [
            softwareId,
          ]);
        }

        // Store version
        await db.query(
          'INSERT INTO software_versions (software_id, version_id, base_version, target_version_hash, is_latest) VALUES ($1, $2, $3, $4, $5)',
          [
            softwareId,
            manifest.version_id,
            manifest.base_version,
            manifest.target_version_hash,
            setLatest,
          ]
        );

        // Store patch metadata
        await db.query(
          'INSERT INTO patch_metadata (software_id, version_id, base_version, patch_hash, patch_size, chunk_size, total_chunks) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            softwareId,
            manifest.version_id,
            manifest.base_version,
            manifest.patch_hash,
            manifest.patch_size,
            manifest.chunk_size,
            manifest.chunks.length,
          ]
        );

        // Store signed update manifest
        await db.query(
          'INSERT INTO update_manifests (software_id, version_id, base_version, manifest_json, signature) VALUES ($1, $2, $3, $4, $5)',
          [
            softwareId,
            manifest.version_id,
            manifest.base_version,
            JSON.stringify(manifest),
            manifest.signature || '',
          ]
        );

        res.status(201).json({
          software_id: softwareId,
          version_id: manifest.version_id,
          base_version: manifest.base_version,
          patch_hash: manifest.patch_hash,
          total_chunks: manifest.chunks.length,
          manifest_url: `/api/software/${softwareId}/versions/${manifest.version_id}/manifest`,
          message: 'Version published successfully',
        });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    }
  );

  // GET /api/software/:softwareId/latest - Get latest version info
  router.get('/software/:softwareId/latest', async (req, res) => {
    try {
      const { softwareId } = req.params;
      const rows = await db.query(
        'SELECT software_id, version_id, base_version, target_version_hash, created_at FROM software_versions WHERE software_id = $1 AND is_latest = true',
        [softwareId]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: `No latest version found for software "${softwareId}"` });
        return;
      }

      const ver = rows[0];
      res.json({
        ...ver,
        manifest_url: `/api/software/${softwareId}/versions/${ver.version_id}/manifest`,
        metadata_url: `/api/software/${softwareId}/versions/${ver.version_id}/metadata`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/software/:softwareId/versions/:versionId - Get specific version info
  router.get('/software/:softwareId/versions/:versionId', async (req, res) => {
    try {
      const { softwareId, versionId } = req.params;
      const rows = await db.query(
        'SELECT software_id, version_id, base_version, target_version_hash, is_latest, created_at FROM software_versions WHERE software_id = $1 AND version_id = $2',
        [softwareId, versionId]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: `Version "${versionId}" not found for "${softwareId}"` });
        return;
      }

      const ver = rows[0];
      res.json({
        ...ver,
        manifest_url: `/api/software/${softwareId}/versions/${versionId}/manifest`,
        metadata_url: `/api/software/${softwareId}/versions/${versionId}/metadata`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/software/:softwareId/versions/:versionId/manifest - Get full manifest
  router.get('/software/:softwareId/versions/:versionId/manifest', async (req, res) => {
    try {
      const { softwareId, versionId } = req.params;
      const rows = await db.query(
        'SELECT manifest_json, signature FROM update_manifests WHERE software_id = $1 AND version_id = $2',
        [softwareId, versionId]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: `Manifest not found for "${softwareId}" version "${versionId}"` });
        return;
      }

      const manifest = rows[0].manifest_json;
      res.json(manifest);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/software/:softwareId/versions/:versionId/metadata - Get patch metadata
  router.get('/software/:softwareId/versions/:versionId/metadata', async (req, res) => {
    try {
      const { softwareId, versionId } = req.params;
      const rows = await db.query(
        'SELECT software_id, version_id, base_version, patch_hash, patch_size, chunk_size, total_chunks, created_at FROM patch_metadata WHERE software_id = $1 AND version_id = $2',
        [softwareId, versionId]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: `Metadata not found for "${softwareId}" version "${versionId}"` });
        return;
      }

      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

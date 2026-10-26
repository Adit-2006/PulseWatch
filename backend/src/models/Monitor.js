import mongoose from 'mongoose';

const monitorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Monitor name is required'],
      trim: true,
      maxlength: [100, 'Monitor name cannot exceed 100 characters'],
    },
    url: {
      type: String,
      required: [true, 'URL is required'],
      trim: true,
      match: [/^https?:\/\/.+/, 'URL must start with http:// or https://'],
    },
    method: {
      type: String,
      enum: {
        values: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        message: '{VALUE} is not a supported HTTP method',
      },
      default: 'GET',
    },
    intervalSeconds: {
      type: Number,
      required: [true, 'Check interval is required'],
      min: [10, 'Interval must be at least 10 seconds'],
      max: [86400, 'Interval cannot exceed 24 hours'],
      default: 60,
    },
    timeoutMs: {
      type: Number,
      min: [1000, 'Timeout must be at least 1000ms'],
      max: [30000, 'Timeout cannot exceed 30 seconds'],
      default: 5000,
    },
    expectedStatus: {
      type: Number,
      min: [100, 'Status code must be at least 100'],
      max: [599, 'Status code must be at most 599'],
      default: 200,
    },
    failureThreshold: {
      type: Number,
      min: [1, 'Failure threshold must be at least 1'],
      max: [20, 'Failure threshold cannot exceed 20'],
      default: 3,
    },
    isPaused: {
      type: Boolean,
      default: false,
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
      min: [0, 'Consecutive failures cannot be negative'],
    },
    nextCheckAt: {
      type: Date,
      default: Date.now,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    publicSlug: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'],
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index: find monitors by user, sorted by creation date
monitorSchema.index({ userId: 1, createdAt: -1 });

// Compound unique index: reject duplicate URLs for the same user
monitorSchema.index({ userId: 1, url: 1 }, { unique: true });

// Scheduler index: find monitors due for checking
monitorSchema.index({ nextCheckAt: 1 });

const Monitor = mongoose.model('Monitor', monitorSchema);

export default Monitor;

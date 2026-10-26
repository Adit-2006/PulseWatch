import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema(
  {
    monitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Monitor',
      required: [true, 'Monitor ID is required'],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['OPEN', 'RESOLVED'],
        message: '{VALUE} is not a valid incident status',
      },
      required: [true, 'Incident status is required'],
      default: 'OPEN',
    },
    startedAt: {
      type: Date,
      required: [true, 'Incident start time is required'],
      default: Date.now,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    failureCount: {
      type: Number,
      default: 1,
      min: [1, 'Failure count must be at least 1'],
    },
    lastErrorMessage: {
      type: String,
      trim: true,
      maxlength: [2000, 'Error message cannot exceed 2000 characters'],
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Partial unique index: only ONE open incident can exist per monitor.
// This is the atomic safety net for the incident state machine — it prevents
// race conditions from creating duplicate open incidents for the same monitor.
incidentSchema.index(
  { monitorId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'OPEN' },
    name: 'unique_open_incident_per_monitor',
  }
);

const Incident = mongoose.model('Incident', incidentSchema);

export default Incident;

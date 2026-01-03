// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentEscrow
 * @notice Bonded commit-reveal escrow primitive for trustless settlement between autonomous agents
 * @dev Implements hash-locked escrow with bond slashing for grief resistance
 */
contract AgentEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Time window for worker to reveal after commit (10 minutes)
    uint256 public constant REVEAL_WINDOW = 10 minutes;

    /// @notice Minimum bond as basis points of payment amount (10%)
    uint256 public constant MIN_BOND_BPS = 1000;

    /// @notice Maximum input size in bytes (4 KB)
    uint256 public constant MAX_INPUT_SIZE = 4096;

    /// @notice Maximum output size in bytes (4 KB)
    uint256 public constant MAX_OUTPUT_SIZE = 4096;

    // ═══════════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════════

    enum TaskState {
        OPEN,
        COMMITTED,
        COMPLETED,
        REFUNDED
    }

    struct Task {
        address requester;
        bytes32 inputHash;
        bytes32 expectedOutputHash;
        bytes32 specHash;
        uint256 amount;
        uint256 bondAmount;
        uint256 deadline;
        TaskState state;
        address committedWorker;
        bytes32 commitHash;
        uint256 revealDeadline;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice MNEE token address
    IERC20 public immutable mnee;

    /// @notice Task storage
    mapping(uint256 => Task) public tasks;

    /// @notice Next task ID
    uint256 public nextTaskId;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event TaskCreated(
        uint256 indexed taskId,
        address indexed requester,
        bytes inputBytes,
        bytes32 inputHash,
        bytes32 expectedOutputHash,
        bytes32 specHash,
        uint256 amount,
        uint256 bondAmount,
        uint256 deadline
    );

    event TaskCommitted(
        uint256 indexed taskId,
        address indexed worker,
        bytes32 commitHash,
        uint256 bondAmount,
        uint256 revealDeadline
    );

    event TaskCompleted(
        uint256 indexed taskId,
        address indexed worker,
        bytes outputBytes
    );

    event TaskRefunded(
        uint256 indexed taskId,
        address indexed requester,
        uint256 amount,
        uint256 slashedBond
    );

    event CommitExpired(
        uint256 indexed taskId,
        address indexed expiredWorker,
        uint256 slashedBond
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error InvalidAmount();
    error InvalidBondAmount();
    error InvalidDeadline();
    error InputTooLarge();
    error OutputTooLarge();
    error TaskNotOpen();
    error TaskNotCommitted();
    error TaskAlreadyFinalized();
    error CommitWindowClosed();
    error RevealWindowExpired();
    error RevealWindowActive();
    error DeadlineNotPassed();
    error NotCommittedWorker();
    error InvalidCommitHash();
    error OutputHashMismatch();

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize the escrow contract
     * @param _mnee Address of the MNEE ERC-20 token
     */
    constructor(address _mnee) {
        mnee = IERC20(_mnee);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EXTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a new task
     * @param inputBytes Raw input data for the task
     * @param expectedOutputHash keccak256 hash of expected output
     * @param specHash Hash of computation specification
     * @param amount Payment amount in MNEE
     * @param bondAmount Required worker bond in MNEE
     * @param deadline Unix timestamp for task expiry
     * @return taskId The ID of the created task
     */
    function createTask(
        bytes calldata inputBytes,
        bytes32 expectedOutputHash,
        bytes32 specHash,
        uint256 amount,
        uint256 bondAmount,
        uint256 deadline
    ) external nonReentrant returns (uint256 taskId) {
        // Validate input size
        if (inputBytes.length > MAX_INPUT_SIZE) revert InputTooLarge();

        // Validate amount
        if (amount == 0) revert InvalidAmount();

        // Validate bond amount (must be at least 10% of payment)
        if (bondAmount < (amount * MIN_BOND_BPS) / 10000) revert InvalidBondAmount();

        // Validate deadline (must be > now + REVEAL_WINDOW)
        if (deadline <= block.timestamp + REVEAL_WINDOW) revert InvalidDeadline();

        // Get task ID and increment
        taskId = nextTaskId++;

        // Compute input hash
        bytes32 inputHash = keccak256(inputBytes);

        // Store task
        tasks[taskId] = Task({
            requester: msg.sender,
            inputHash: inputHash,
            expectedOutputHash: expectedOutputHash,
            specHash: specHash,
            amount: amount,
            bondAmount: bondAmount,
            deadline: deadline,
            state: TaskState.OPEN,
            committedWorker: address(0),
            commitHash: bytes32(0),
            revealDeadline: 0
        });

        // Transfer payment from requester
        mnee.safeTransferFrom(msg.sender, address(this), amount);

        // Emit event with full input bytes
        emit TaskCreated(
            taskId,
            msg.sender,
            inputBytes,
            inputHash,
            expectedOutputHash,
            specHash,
            amount,
            bondAmount,
            deadline
        );
    }

    /**
     * @notice Commit to completing a task
     * @param taskId The task to commit to
     * @param commitHash keccak256(abi.encode(outputHash, salt))
     */
    function commit(uint256 taskId, bytes32 commitHash) external nonReentrant {
        Task storage task = tasks[taskId];

        // Validate state
        if (task.state != TaskState.OPEN) revert TaskNotOpen();

        // Validate timing - strict < to ensure revealDeadline < deadline
        if (block.timestamp >= task.deadline - REVEAL_WINDOW) revert CommitWindowClosed();

        // Set reveal deadline
        uint256 revealDeadline = block.timestamp + REVEAL_WINDOW;

        // Update task state
        task.state = TaskState.COMMITTED;
        task.committedWorker = msg.sender;
        task.commitHash = commitHash;
        task.revealDeadline = revealDeadline;

        // Transfer bond from worker
        mnee.safeTransferFrom(msg.sender, address(this), task.bondAmount);

        emit TaskCommitted(taskId, msg.sender, commitHash, task.bondAmount, revealDeadline);
    }

    /**
     * @notice Reveal output and claim payment
     * @param taskId The task to reveal for
     * @param outputBytes The actual output data
     * @param salt The random salt used in commit
     */
    function reveal(
        uint256 taskId,
        bytes calldata outputBytes,
        bytes32 salt
    ) external nonReentrant {
        Task storage task = tasks[taskId];

        // Validate output size
        if (outputBytes.length > MAX_OUTPUT_SIZE) revert OutputTooLarge();

        // Validate state
        if (task.state != TaskState.COMMITTED) revert TaskNotCommitted();

        // Validate caller is committed worker (front-run protection)
        if (msg.sender != task.committedWorker) revert NotCommittedWorker();

        // Validate timing
        if (block.timestamp > task.revealDeadline) revert RevealWindowExpired();

        // Compute output hash
        bytes32 outputHash = keccak256(outputBytes);

        // Verify commit hash
        bytes32 expectedCommitHash = keccak256(abi.encode(outputHash, salt));
        if (expectedCommitHash != task.commitHash) revert InvalidCommitHash();

        // Verify output matches expected
        if (outputHash != task.expectedOutputHash) revert OutputHashMismatch();

        // Update state
        task.state = TaskState.COMPLETED;

        // Transfer payment + bond to worker
        uint256 totalPayout = task.amount + task.bondAmount;
        mnee.safeTransfer(msg.sender, totalPayout);

        emit TaskCompleted(taskId, msg.sender, outputBytes);
    }

    /**
     * @notice Expire a stale commit and slash bond
     * @param taskId The task with expired commit
     */
    function expireCommit(uint256 taskId) external nonReentrant {
        Task storage task = tasks[taskId];

        // Validate state
        if (task.state != TaskState.COMMITTED) revert TaskNotCommitted();

        // Validate timing: must be after reveal window but before deadline
        if (block.timestamp <= task.revealDeadline) revert RevealWindowActive();
        if (block.timestamp > task.deadline) revert DeadlineNotPassed();

        // Store expired worker for event
        address expiredWorker = task.committedWorker;
        uint256 slashedBond = task.bondAmount;

        // Reset task to OPEN
        task.state = TaskState.OPEN;
        task.committedWorker = address(0);
        task.commitHash = bytes32(0);
        task.revealDeadline = 0;

        // Slash bond to requester
        mnee.safeTransfer(task.requester, slashedBond);

        emit CommitExpired(taskId, expiredWorker, slashedBond);
    }

    /**
     * @notice Claim timeout for an expired task
     * @dev Callable by anyone - funds always go to requester
     * @param taskId The expired task
     */
    function claimTimeout(uint256 taskId) external nonReentrant {
        Task storage task = tasks[taskId];

        // Validate state - must not be already finalized
        if (task.state == TaskState.COMPLETED || task.state == TaskState.REFUNDED) {
            revert TaskAlreadyFinalized();
        }

        // Validate timing - deadline must have passed
        if (block.timestamp <= task.deadline) revert DeadlineNotPassed();

        // If committed, also check reveal deadline passed (deadline rug protection)
        if (task.state == TaskState.COMMITTED) {
            if (block.timestamp <= task.revealDeadline) revert RevealWindowActive();
        }

        // Calculate refund and slashed bond
        uint256 refundAmount = task.amount;
        uint256 slashedBond = 0;

        if (task.state == TaskState.COMMITTED) {
            slashedBond = task.bondAmount;
        }

        // Update state
        task.state = TaskState.REFUNDED;

        // Transfer funds to requester (not msg.sender!)
        if (slashedBond > 0) {
            mnee.safeTransfer(task.requester, refundAmount + slashedBond);
        } else {
            mnee.safeTransfer(task.requester, refundAmount);
        }

        emit TaskRefunded(taskId, task.requester, refundAmount, slashedBond);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get full task data
     * @param taskId The task ID
     * @return The task struct
     */
    function getTask(uint256 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }
}

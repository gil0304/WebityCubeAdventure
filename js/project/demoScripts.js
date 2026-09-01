/* Webity Cube Adventure — demo project C# sources (compiled & executed by the CS runtime) */
"use strict";

const DEMO_SCRIPTS = {};

DEMO_SCRIPTS["Assets/Scripts/Player/PlayerController.cs"] = `using UnityEngine;

public class PlayerController : MonoBehaviour
{
    [Header("Movement")]
    public float moveSpeed = 6f;
    public float dashSpeed = 10f;
    public float jumpForce = 8f;
    [Range(0f, 1f)]
    public float airControl = 0.4f;
    public float rotationSpeed = 12f;

    [Header("Ground Check")]
    public Transform groundCheck;
    public float groundRadius = 0.34f;
    public LayerMask groundLayer;

    [Header("References")]
    public Transform cameraTransform;

    [Header("Abilities")]
    public bool enableDoubleJump = true;

    private Rigidbody rb;
    private bool isGrounded;
    private bool wasGrounded = true;
    private bool canDoubleJump;
    private float inputX;
    private float inputZ;
    private bool jumpQueued;
    private bool dashing;

    void Awake()
    {
        rb = GetComponent<Rigidbody>();
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.R) && GameManager.Instance != null)
        {
            GameManager.Instance.RestartGame();
            return;
        }

        if (GameManager.Instance != null && !GameManager.Instance.IsPlaying())
        {
            inputX = 0f;
            inputZ = 0f;
            return;
        }

        inputX = Input.GetAxis("Horizontal");
        inputZ = Input.GetAxis("Vertical");
        dashing = Input.GetButton("Dash");

        if (Input.GetButtonDown("Jump"))
        {
            jumpQueued = true;
        }
    }

    void FixedUpdate()
    {
        isGrounded = Physics.CheckSphere(groundCheck.position, groundRadius, groundLayer);

        if (isGrounded && !wasGrounded)
        {
            AudioManager.Instance.Play("land");
        }
        wasGrounded = isGrounded;

        Vector3 moveDir = ComputeMoveDirection();
        float targetSpeed = dashing ? dashSpeed : moveSpeed;
        Vector3 desired = moveDir * targetSpeed;

        Vector3 velocity = rb.velocity;
        float control = isGrounded ? 0.55f : airControl * 0.35f;
        velocity.x = Mathf.Lerp(velocity.x, desired.x, control);
        velocity.z = Mathf.Lerp(velocity.z, desired.z, control);

        if (jumpQueued)
        {
            if (isGrounded)
            {
                velocity.y = jumpForce;
                canDoubleJump = enableDoubleJump;
                AudioManager.Instance.Play("jump");
            }
            else if (canDoubleJump)
            {
                velocity.y = jumpForce * 0.92f;
                canDoubleJump = false;
                AudioManager.Instance.Play("doublejump");
            }
        }
        jumpQueued = false;

        rb.velocity = velocity;

        Vector3 flat = new Vector3(moveDir.x, 0f, moveDir.z);
        if (flat.sqrMagnitude > 0.001f)
        {
            Quaternion targetRot = Quaternion.LookRotation(flat.normalized);
            transform.rotation = Quaternion.Slerp(
                transform.rotation, targetRot, rotationSpeed * Time.fixedDeltaTime);
        }
    }

    private Vector3 ComputeMoveDirection()
    {
        Vector3 forward = Vector3.forward;
        Vector3 right = Vector3.right;
        if (cameraTransform != null)
        {
            forward = Vector3.ProjectOnPlane(cameraTransform.forward, Vector3.up).normalized;
            right = Vector3.ProjectOnPlane(cameraTransform.right, Vector3.up).normalized;
        }
        Vector3 dir = forward * inputZ + right * inputX;
        if (dir.sqrMagnitude > 1f) dir = dir.normalized;
        return dir;
    }

    public bool IsGrounded()
    {
        return isGrounded;
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Player/PlayerHealth.cs"] = `using UnityEngine;
using System.Collections;

public class PlayerHealth : MonoBehaviour
{
    public int maxLives = 3;
    public float invincibleTime = 1.5f;
    public Transform modelRoot;

    private int currentLives;
    private float invincibleUntil;
    private Rigidbody rb;

    void Awake()
    {
        rb = GetComponent<Rigidbody>();
        currentLives = maxLives;
    }

    public int GetLives()
    {
        return currentLives;
    }

    public void TakeDamage(int amount)
    {
        if (Time.time < invincibleUntil) return;
        if (GameManager.Instance != null && !GameManager.Instance.IsPlaying()) return;

        currentLives = currentLives - amount;
        invincibleUntil = Time.time + invincibleTime;
        AudioManager.Instance.Play("damage");
        GameManager.Instance.OnPlayerDamaged(currentLives);

        if (currentLives <= 0)
        {
            GameManager.Instance.GameOver("NO LIVES LEFT");
        }
        else
        {
            StartCoroutine(BlinkRoutine());
        }
    }

    public void Respawn(Vector3 position)
    {
        rb.velocity = Vector3.zero;
        transform.position = position;
        invincibleUntil = Time.time + 1f;
    }

    void OnTriggerEnter(Collider other)
    {
        if (other.CompareTag("KillZone"))
        {
            GameManager.Instance.OnPlayerFell();
        }
        else if (other.CompareTag("Checkpoint"))
        {
            GameManager.Instance.SetCheckpoint(other.transform.position);
            AudioManager.Instance.Play("checkpoint");
            MeshRenderer mr = other.GetComponent<MeshRenderer>();
            if (mr != null)
            {
                mr.material.SetColor("_EmissionColor", Color.green);
            }
        }
    }

    IEnumerator BlinkRoutine()
    {
        MeshRenderer rend = null;
        if (modelRoot != null)
        {
            rend = modelRoot.gameObject.GetComponentInChildren<MeshRenderer>();
        }
        if (rend == null) yield break;

        for (int i = 0; i < 9; i++)
        {
            rend.enabled = !rend.enabled;
            yield return new WaitForSeconds(0.09f);
        }
        rend.enabled = true;
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Player/PlayerCollector.cs"] = `using UnityEngine;

public class PlayerCollector : MonoBehaviour
{
    public ParticleSystem collectEffect;

    private int collected;

    public int GetCollected()
    {
        return collected;
    }

    public void Collect(CollectibleItem item)
    {
        collected = collected + 1;
        AudioManager.Instance.Play("collect");
        if (collectEffect != null)
        {
            collectEffect.Emit(26);
        }
        GameManager.Instance.OnCrystalCollected(collected);
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Camera/FollowCamera.cs"] = `using UnityEngine;

public class FollowCamera : MonoBehaviour
{
    public Transform target;
    public float distance = 7f;
    public float height = 3.5f;
    public float followSpeed = 8f;
    public float rotationSpeed = 4f;
    public LayerMask collisionMask;

    private float yaw;

    void Start()
    {
        if (target != null)
        {
            Vector3 offset = transform.position - target.position;
            if (offset.sqrMagnitude > 0.01f)
            {
                yaw = Mathf.Atan2(-offset.x, -offset.z) * Mathf.Rad2Deg;
            }
        }
    }

    void LateUpdate()
    {
        if (target == null) return;

        float targetYaw = target.eulerAngles.y;
        yaw = Mathf.LerpAngle(yaw, targetYaw, rotationSpeed * Time.deltaTime);

        Quaternion rot = Quaternion.Euler(0f, yaw, 0f);
        Vector3 back = rot * new Vector3(0f, 0f, -1f);
        Vector3 desired = target.position + back * distance + Vector3.up * height;

        Vector3 castDir = (desired - target.position).normalized;
        float castDist = Vector3.Distance(desired, target.position);
        if (Physics.Raycast(target.position, castDir, out RaycastHit hit, castDist, collisionMask))
        {
            desired = target.position + castDir * Mathf.Max(hit.distance - 0.3f, 1.2f);
        }

        transform.position = Vector3.Lerp(
            transform.position, desired, followSpeed * Time.deltaTime);

        Vector3 lookPoint = target.position + Vector3.up * 0.6f;
        transform.rotation = Quaternion.LookRotation(lookPoint - transform.position);
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Obstacles/RotatingObstacle.cs"] = `using UnityEngine;

public enum RotationAxis { X, Y, Z }

public class RotatingObstacle : MonoBehaviour
{
    public RotationAxis rotationAxis = RotationAxis.Y;
    public float rotationSpeed = 90f;
    public bool reverse = false;

    void Update()
    {
        float dir = reverse ? -1f : 1f;
        float amount = rotationSpeed * dir * Time.deltaTime;

        if (rotationAxis == RotationAxis.X)
        {
            transform.Rotate(amount, 0f, 0f);
        }
        else if (rotationAxis == RotationAxis.Y)
        {
            transform.Rotate(0f, amount, 0f);
        }
        else
        {
            transform.Rotate(0f, 0f, amount);
        }
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Obstacles/MovingPlatform.cs"] = `using UnityEngine;

public class MovingPlatform : MonoBehaviour
{
    public Transform pointA;
    public Transform pointB;
    public float moveSpeed = 3f;
    public float waitTime = 1f;
    public bool easeMovement = true;

    private Rigidbody rb;
    private float progress;
    private int direction = 1;
    private float waitUntil;

    void Awake()
    {
        rb = GetComponent<Rigidbody>();
    }

    void FixedUpdate()
    {
        if (pointA == null || pointB == null) return;
        if (Time.time < waitUntil) return;

        float length = Vector3.Distance(pointA.position, pointB.position);
        if (length < 0.01f) return;

        progress = progress + (moveSpeed / length) * direction * Time.fixedDeltaTime;
        if (progress >= 1f)
        {
            progress = 1f;
            direction = -1;
            waitUntil = Time.time + waitTime;
        }
        else if (progress <= 0f)
        {
            progress = 0f;
            direction = 1;
            waitUntil = Time.time + waitTime;
        }

        float t = progress;
        if (easeMovement) t = Mathf.SmoothStep(0f, 1f, progress);
        rb.MovePosition(Vector3.Lerp(pointA.position, pointB.position, t));
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Obstacles/FallingFloor.cs"] = `using UnityEngine;
using System.Collections;

public class FallingFloor : MonoBehaviour
{
    public float fallDelay = 1.2f;
    public float respawnDelay = 4f;
    public float shakeDuration = 0.8f;
    public float shakeAmount = 0.05f;

    private Vector3 startPos;
    private bool triggered;
    private Rigidbody rb;

    void Awake()
    {
        rb = GetComponent<Rigidbody>();
        startPos = transform.position;
    }

    void OnCollisionEnter(Collision collision)
    {
        if (triggered) return;
        if (!collision.gameObject.CompareTag("Player")) return;
        triggered = true;
        StartCoroutine(FallSequence());
    }

    IEnumerator FallSequence()
    {
        AudioManager.Instance.Play("falling_floor");

        float waitBeforeShake = fallDelay - shakeDuration;
        if (waitBeforeShake > 0f)
        {
            yield return new WaitForSeconds(waitBeforeShake);
        }

        float elapsed = 0f;
        while (elapsed < shakeDuration)
        {
            elapsed = elapsed + Time.deltaTime;
            float ox = Random.Range(-shakeAmount, shakeAmount);
            float oz = Random.Range(-shakeAmount, shakeAmount);
            rb.MovePosition(startPos + new Vector3(ox, 0f, oz));
            yield return null;
        }

        float fallSpeed = 0f;
        float fallen = 0f;
        while (fallen < 14f)
        {
            fallSpeed = fallSpeed + 22f * Time.deltaTime;
            fallen = fallen + fallSpeed * Time.deltaTime;
            rb.MovePosition(startPos + Vector3.down * fallen);
            yield return null;
        }

        gameObject.SetActive(false);
        yield return new WaitForSeconds(respawnDelay);
        transform.position = startPos;
        rb.MovePosition(startPos);
        gameObject.SetActive(true);
        triggered = false;
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Obstacles/JumpPad.cs"] = `using UnityEngine;

public class JumpPad : MonoBehaviour
{
    public float jumpPower = 15f;
    public ParticleSystem effect;
    public float cooldown = 0.25f;

    private float nextTime;

    void OnTriggerEnter(Collider other)
    {
        Launch(other);
    }

    void OnTriggerStay(Collider other)
    {
        Launch(other);
    }

    private void Launch(Collider other)
    {
        if (Time.time < nextTime) return;
        if (!other.CompareTag("Player")) return;

        Rigidbody body = other.GetComponent<Rigidbody>();
        if (body == null) return;

        nextTime = Time.time + cooldown;
        Vector3 velocity = body.velocity;
        velocity.y = jumpPower;
        body.velocity = velocity;

        AudioManager.Instance.Play("jumppad");
        if (effect != null)
        {
            effect.Emit(32);
        }
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Obstacles/Pendulum.cs"] = `using UnityEngine;

public class Pendulum : MonoBehaviour
{
    public float swingAngle = 55f;
    public float swingSpeed = 1.2f;
    public float phase = 0f;

    private Rigidbody rb;

    void Awake()
    {
        rb = GetComponent<Rigidbody>();
    }

    void FixedUpdate()
    {
        float angle = Mathf.Sin(Time.time * swingSpeed + phase) * swingAngle;
        Quaternion rot = Quaternion.Euler(0f, 0f, angle);
        if (rb != null)
        {
            rb.MoveRotation(rot);
        }
        else
        {
            transform.rotation = rot;
        }
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Items/CollectibleItem.cs"] = `using UnityEngine;

public class CollectibleItem : MonoBehaviour
{
    public float rotateSpeed = 90f;
    public float bobHeight = 0.25f;
    public float bobSpeed = 2f;

    private Vector3 startPos;
    private bool collected;

    void Start()
    {
        startPos = transform.position;
    }

    void Update()
    {
        transform.Rotate(0f, rotateSpeed * Time.deltaTime, 0f);
        float y = startPos.y + Mathf.Sin(Time.time * bobSpeed) * bobHeight;
        transform.position = new Vector3(startPos.x, y, startPos.z);
    }

    void OnTriggerEnter(Collider other)
    {
        if (collected) return;
        if (!other.CompareTag("Player")) return;

        PlayerCollector collector = other.GetComponent<PlayerCollector>();
        if (collector == null) return;

        collected = true;
        collector.Collect(this);

        ParticleSystem ps = GetComponent<ParticleSystem>();
        if (ps != null)
        {
            ps.Emit(18);
        }
        gameObject.SetActive(false);
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Enemy/EnemyController.cs"] = `using UnityEngine;

public enum EnemyState { Patrol, Chase, Return }

public class EnemyController : MonoBehaviour
{
    [Header("Patrol")]
    public Transform[] patrolPoints;
    public float patrolSpeed = 2f;

    [Header("Chase")]
    public float chaseSpeed = 4f;
    public float detectionDistance = 8f;
    public float attackDistance = 1.2f;
    public int damage = 1;
    public float leashDistance = 14f;
    public Transform target;

    private EnemyState state = EnemyState.Patrol;
    private int patrolIndex;
    private Rigidbody rb;
    private Vector3 homePos;
    private float nextDamageTime;

    void Awake()
    {
        rb = GetComponent<Rigidbody>();
        homePos = transform.position;
    }

    void Start()
    {
        if (target == null)
        {
            GameObject player = GameObject.FindWithTag("Player");
            if (player != null) target = player.transform;
        }
    }

    void FixedUpdate()
    {
        if (GameManager.Instance != null && !GameManager.Instance.IsPlaying()) return;

        float dt = Time.fixedDeltaTime;
        Vector3 pos = transform.position;

        float distToPlayer = 99999f;
        if (target != null)
        {
            distToPlayer = Vector3.Distance(pos, target.position);
        }
        float distFromHome = Vector3.Distance(pos, homePos);

        if (state == EnemyState.Patrol)
        {
            if (distToPlayer < detectionDistance)
            {
                state = EnemyState.Chase;
                AudioManager.Instance.Play("enemy_alert");
            }
            else
            {
                PatrolMove(dt);
            }
        }
        else if (state == EnemyState.Chase)
        {
            if (distToPlayer > detectionDistance * 1.6f || distFromHome > leashDistance)
            {
                state = EnemyState.Return;
            }
            else
            {
                ChaseMove(dt);
            }
        }
        else
        {
            if (distToPlayer < detectionDistance && distFromHome < leashDistance * 0.8f)
            {
                state = EnemyState.Chase;
            }
            else
            {
                ReturnMove(dt);
            }
        }
    }

    private void PatrolMove(float dt)
    {
        if (patrolPoints == null || patrolPoints.Length == 0) return;
        Transform wp = patrolPoints[patrolIndex];
        if (wp == null) return;
        Vector3 targetPos = new Vector3(wp.position.x, transform.position.y, wp.position.z);
        MoveTowardsPoint(targetPos, patrolSpeed, dt);
        if (Vector3.Distance(transform.position, targetPos) < 0.25f)
        {
            patrolIndex = (patrolIndex + 1) % patrolPoints.Length;
        }
    }

    private void ChaseMove(float dt)
    {
        if (target == null) return;
        Vector3 targetPos = new Vector3(target.position.x, transform.position.y, target.position.z);
        if (Vector3.Distance(transform.position, targetPos) > attackDistance * 0.7f)
        {
            MoveTowardsPoint(targetPos, chaseSpeed, dt);
        }
    }

    private void ReturnMove(float dt)
    {
        Vector3 targetPos = new Vector3(homePos.x, transform.position.y, homePos.z);
        MoveTowardsPoint(targetPos, patrolSpeed * 1.2f, dt);
        if (Vector3.Distance(transform.position, targetPos) < 0.3f)
        {
            state = EnemyState.Patrol;
        }
    }

    private void MoveTowardsPoint(Vector3 targetPos, float speed, float dt)
    {
        Vector3 next = Vector3.MoveTowards(transform.position, targetPos, speed * dt);
        rb.MovePosition(next);
        Vector3 dir = targetPos - transform.position;
        dir.y = 0f;
        if (dir.sqrMagnitude > 0.002f)
        {
            Quaternion look = Quaternion.LookRotation(dir.normalized);
            rb.MoveRotation(Quaternion.Slerp(transform.rotation, look, 10f * dt));
        }
    }

    void OnTriggerStay(Collider other)
    {
        if (!other.CompareTag("Player")) return;
        if (Time.time < nextDamageTime) return;
        PlayerHealth health = other.GetComponent<PlayerHealth>();
        if (health == null) return;
        nextDamageTime = Time.time + 1.2f;
        health.TakeDamage(damage);
    }

    public EnemyState GetState()
    {
        return state;
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Managers/GameManager.cs"] = `using UnityEngine;

public enum GameState { Playing, Paused, GameOver, Cleared }

public class GameManager : MonoBehaviour
{
    public static GameManager Instance;

    [Header("Rules")]
    public float timeLimit = 180f;
    public int totalCrystals = 5;

    [Header("References")]
    public PlayerHealth player;
    public UIManager ui;

    private GameState state = GameState.Playing;
    private float remainingTime;
    private int crystals;
    private int damageTaken;
    private Vector3 checkpoint;

    void Awake()
    {
        Instance = this;
        remainingTime = timeLimit;
    }

    void Start()
    {
        if (player != null)
        {
            checkpoint = player.transform.position;
        }
        CollectibleItem[] found = FindObjectsOfType<CollectibleItem>();
        if (found.Length > 0)
        {
            totalCrystals = found.Length;
        }
        if (ui != null)
        {
            ui.UpdateCrystals(0, totalCrystals);
            ui.UpdateTimer(remainingTime);
            if (player != null) ui.UpdateLives(player.GetLives());
        }
        Debug.Log("Webity Cube Adventure started. Crystals in stage: " + totalCrystals);
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.Escape))
        {
            if (state == GameState.Playing || state == GameState.Paused)
            {
                TogglePause();
            }
        }

        if (state != GameState.Playing) return;

        remainingTime = remainingTime - Time.deltaTime;
        if (ui != null) ui.UpdateTimer(remainingTime);
        if (remainingTime <= 0f)
        {
            remainingTime = 0f;
            GameOver("TIME UP");
        }
    }

    public bool IsPlaying()
    {
        return state == GameState.Playing;
    }

    public void OnCrystalCollected(int count)
    {
        crystals = count;
        if (ui != null) ui.UpdateCrystals(crystals, totalCrystals);
    }

    public void OnPlayerDamaged(int livesLeft)
    {
        damageTaken = damageTaken + 1;
        if (ui != null) ui.UpdateLives(livesLeft);
    }

    public void OnPlayerFell()
    {
        if (state != GameState.Playing) return;
        AudioManager.Instance.Play("fall");
        if (player != null)
        {
            player.TakeDamage(1);
            if (state == GameState.Playing)
            {
                player.Respawn(checkpoint);
            }
        }
    }

    public void SetCheckpoint(Vector3 position)
    {
        checkpoint = position + Vector3.up * 1f;
        if (ui != null) ui.ShowMessage("CHECKPOINT!");
    }

    public void ReachGoal()
    {
        if (state != GameState.Playing) return;
        if (crystals < totalCrystals)
        {
            if (ui != null)
            {
                ui.ShowMessage("クリスタルが足りません " + crystals + " / " + totalCrystals);
            }
            return;
        }
        state = GameState.Cleared;
        float clearTime = timeLimit - remainingTime;
        AudioManager.Instance.Play("goal");
        AudioManager.Instance.StopBgm();
        if (ui != null)
        {
            ui.ShowClear(clearTime, crystals, totalCrystals, damageTaken, ComputeRank(clearTime));
        }
    }

    private string ComputeRank(float clearTime)
    {
        if (damageTaken == 0 && clearTime < 95f) return "S";
        if (damageTaken <= 1 && clearTime < 130f) return "A";
        if (clearTime < 160f) return "B";
        return "C";
    }

    public void GameOver(string reason)
    {
        if (state == GameState.GameOver || state == GameState.Cleared) return;
        state = GameState.GameOver;
        Debug.Log("Game over: " + reason);
        AudioManager.Instance.Play("gameover");
        AudioManager.Instance.StopBgm();
        if (ui != null) ui.ShowGameOver();
    }

    public void TogglePause()
    {
        if (state == GameState.Playing)
        {
            state = GameState.Paused;
            Time.timeScale = 0f;
            if (ui != null) ui.ShowPause(true);
        }
        else if (state == GameState.Paused)
        {
            state = GameState.Playing;
            Time.timeScale = 1f;
            if (ui != null) ui.ShowPause(false);
        }
    }

    public void RestartGame()
    {
        Time.timeScale = 1f;
        SceneManager.LoadScene("MainGame");
    }

    public void OnResumeButton() { if (state == GameState.Paused) TogglePause(); }
    public void OnRestartButton() { RestartGame(); }
    public void OnRetryButton() { RestartGame(); }
    public void OnNextButton()
    {
        if (ui != null) ui.ShowMessage("Thanks for playing! (NEXT stage is up to you...)");
    }
    public void OnSettingsButton() { if (ui != null) ui.ToggleSettings(); }
    public void OnQuitButton()
    {
        if (ui != null) ui.ShowMessage("Press the Stop button in the editor to quit Play Mode");
        Application.Quit();
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Managers/AudioManager.cs"] = `using UnityEngine;

public class AudioManager : MonoBehaviour
{
    public static AudioManager Instance;

    [Header("Sources")]
    public AudioSource sfxSource;
    public AudioSource bgmSource;

    [Header("Clips")]
    public AudioClip jumpClip;
    public AudioClip doubleJumpClip;
    public AudioClip landClip;
    public AudioClip collectClip;
    public AudioClip damageClip;
    public AudioClip fallClip;
    public AudioClip jumpPadClip;
    public AudioClip checkpointClip;
    public AudioClip goalClip;
    public AudioClip gameOverClip;
    public AudioClip clickClip;
    public AudioClip alertClip;
    public AudioClip fallingFloorClip;

    void Awake()
    {
        Instance = this;
    }

    public void Play(string id)
    {
        if (sfxSource == null) return;
        AudioClip clip = null;
        switch (id)
        {
            case "jump": clip = jumpClip; break;
            case "doublejump": clip = doubleJumpClip; break;
            case "land": clip = landClip; break;
            case "collect": clip = collectClip; break;
            case "damage": clip = damageClip; break;
            case "fall": clip = fallClip; break;
            case "jumppad": clip = jumpPadClip; break;
            case "checkpoint": clip = checkpointClip; break;
            case "goal": clip = goalClip; break;
            case "gameover": clip = gameOverClip; break;
            case "click": clip = clickClip; break;
            case "enemy_alert": clip = alertClip; break;
            case "falling_floor": clip = fallingFloorClip; break;
        }
        if (clip != null)
        {
            sfxSource.PlayOneShot(clip);
        }
    }

    public void StopBgm()
    {
        if (bgmSource != null) bgmSource.Stop();
    }

    public void OnBgmUp() { AdjustBgm(0.1f); }
    public void OnBgmDown() { AdjustBgm(-0.1f); }
    public void OnSfxUp() { AdjustSfx(0.1f); }
    public void OnSfxDown() { AdjustSfx(-0.1f); }

    private void AdjustBgm(float delta)
    {
        if (bgmSource == null) return;
        bgmSource.volume = Mathf.Clamp01(bgmSource.volume + delta);
    }

    private void AdjustSfx(float delta)
    {
        if (sfxSource == null) return;
        sfxSource.volume = Mathf.Clamp01(sfxSource.volume + delta);
        Play("click");
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Managers/UIManager.cs"] = `using UnityEngine;
using UnityEngine.UI;

public class UIManager : MonoBehaviour
{
    [Header("HUD")]
    public Text crystalText;
    public Text timerText;
    public Text lifeText;
    public Text messageText;

    [Header("Panels")]
    public GameObject pausePanel;
    public GameObject gameOverPanel;
    public GameObject clearPanel;
    public GameObject settingsPanel;
    public Text clearStatsText;

    public void UpdateCrystals(int current, int total)
    {
        if (crystalText != null)
        {
            crystalText.text = "CRYSTAL  " + current + " / " + total;
        }
    }

    public void UpdateTimer(float seconds)
    {
        if (timerText == null) return;
        if (seconds < 0f) seconds = 0f;
        int m = Mathf.FloorToInt(seconds / 60f);
        int s = Mathf.FloorToInt(seconds % 60f);
        timerText.text = "TIME     " + m.ToString("00") + ":" + s.ToString("00");
    }

    public void UpdateLives(int lives)
    {
        if (lifeText == null) return;
        string hearts = "";
        for (int i = 0; i < lives; i++)
        {
            hearts = hearts + "\\u25cf ";
        }
        if (lives <= 0) hearts = "-";
        lifeText.text = "LIFE     " + hearts;
    }

    public void ShowMessage(string msg)
    {
        if (messageText == null) return;
        messageText.text = msg;
        messageText.gameObject.SetActive(true);
        CancelInvoke("HideMessage");
        Invoke("HideMessage", 2.5f);
    }

    public void HideMessage()
    {
        if (messageText != null) messageText.gameObject.SetActive(false);
    }

    public void ShowPause(bool show)
    {
        if (pausePanel != null) pausePanel.SetActive(show);
        if (!show && settingsPanel != null) settingsPanel.SetActive(false);
    }

    public void ToggleSettings()
    {
        if (settingsPanel != null) settingsPanel.SetActive(!settingsPanel.activeSelf);
    }

    public void ShowGameOver()
    {
        if (gameOverPanel != null) gameOverPanel.SetActive(true);
    }

    public void ShowClear(float time, int crystals, int total, int damage, string rank)
    {
        if (clearPanel != null) clearPanel.SetActive(true);
        if (clearStatsText != null)
        {
            int m = Mathf.FloorToInt(time / 60f);
            int s = Mathf.FloorToInt(time % 60f);
            clearStatsText.text =
                "TIME       " + m.ToString("00") + ":" + s.ToString("00") +
                "\\nCRYSTAL    " + crystals + " / " + total +
                "\\nDAMAGE     " + damage +
                "\\nRANK       " + rank;
        }
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Managers/SceneLoader.cs"] = `using UnityEngine;

public class SceneLoader : MonoBehaviour
{
    public string mainSceneName = "MainGame";

    public void ReloadScene()
    {
        SceneManager.LoadScene(mainSceneName);
    }
}
`;

DEMO_SCRIPTS["Assets/Scripts/Goal/GoalController.cs"] = `using UnityEngine;

public class GoalController : MonoBehaviour
{
    public float rotateSpeed = 40f;
    public Transform ring;

    void Update()
    {
        if (ring != null)
        {
            ring.Rotate(0f, 0f, rotateSpeed * Time.deltaTime);
        }
    }

    void OnTriggerEnter(Collider other)
    {
        if (!other.CompareTag("Player")) return;
        if (GameManager.Instance == null) return;
        GameManager.Instance.ReachGoal();
    }
}
`;
